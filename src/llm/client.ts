// One structured model call over the OpenAI chat completions API, against
// Meterless Nightshift or NVIDIA directly. NVIDIA's strict json_schema mode
// tends to run away (pages of whitespace until max_tokens), so we ask for a
// JSON object, put the schema in the prompt, validate with zod, and give the
// model one repair turn with the exact validation error.
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { fallbackProvider, modelFor, providerConfig, type ProviderConfig, type Tier } from "../config";
import { METERLESS_APP, METERLESS_TIMEOUT_MS } from "../meterless/runtime";
import { budgetFromEnv, checkBudget, readUsage, recordUsage, usageFile, type Budget } from "./usage";

export interface JsonCall<S extends z.ZodType> {
  agent: string;
  instructions: string;
  input: string;
  schema: S;
  /** fast for bulk reading, deep for reasoning and answers. */
  tier?: Tier;
  /** Overrides the tier's model on the primary provider. */
  model?: string;
  maxTokens?: number;
  /** Nemotron reasoning traces cost tokens; off unless an agent needs them. */
  thinking?: boolean;
  signal?: AbortSignal;
  /** Per-attempt timeout; defaults to 180 s on Meterless and 120 s on NVIDIA. */
  timeoutMs?: number;
  /** Called after every attempt with that attempt's token counts. */
  onUsage?: (usage: { inputTokens: number; outputTokens: number; model: string; provider: string }) => void;
}

export interface ClientDeps {
  provider?: ProviderConfig;
  /** null disables the fallback. */
  fallback?: ProviderConfig | null;
  budget?: Budget;
  usagePath?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Sample mode: record what the models answered during a live run, or replay
 * those answers with no provider at all. A replayed answer is validated
 * against the agent's schema exactly like a live one.
 */
export interface ModelTap {
  replay?: (agent: string) => unknown;
  record?: (agent: string, output: unknown) => void;
}
export const modelTap = new AsyncLocalStorage<ModelTap>();

export class ModelOutputError extends Error {
  override name = "ModelOutputError";
}

/** The answer hit max_tokens: asking again with the same input only truncates again. */
export class OutputTooLongError extends ModelOutputError {
  override name = "OutputTooLongError";
}

/** A 4xx other than 429 (bad model id, bad key) won't succeed on retry. */
class ProviderRejectedError extends Error {
  override name = "ProviderRejectedError";
}

/** The provider could not be reached at all (as opposed to answering badly). */
class TransportError extends Error {
  override name = "TransportError";
}

function systemPrompt(instructions: string, schema: z.ZodType): string {
  return (
    `${instructions}\n\n` +
    "Answer with one JSON object and nothing else. It must match this JSON Schema exactly " +
    "(same field names, every required field present, no extra fields):\n" +
    JSON.stringify(z.toJSONSchema(schema))
  );
}

function headers(provider: ProviderConfig): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${provider.apiKey}`,
    "Content-Type": "application/json",
  };
  if (provider.name === "meterless") {
    h["meterless-app"] = METERLESS_APP;
    h["meterless-scope"] = "user";
  }
  return h;
}

function requestBody(provider: ProviderConfig, model: string, messages: ChatMessage[], call: JsonCall<z.ZodType>) {
  return {
    model,
    messages,
    max_tokens: call.maxTokens ?? 2000,
    temperature: 0.2,
    response_format: { type: "json_object" },
    // NVIDIA NIM switch for Nemotron's reasoning trace; the runtime picks its own lane settings.
    ...(provider.name === "nvidia" ? { chat_template_kwargs: { enable_thinking: call.thinking ?? false } } : {}),
  };
}

const ID_KEYS = new Set(["id", "from", "to", "edge", "path", "kind", "flowId"]);

/**
 * Repairs an answer without another model call: a null or missing descriptive
 * string becomes "", and a list item that still doesn't fit is dropped on its
 * own. Identifiers are never invented. Returns the parse result after salvage.
 */
export function salvage<S extends z.ZodType>(schema: S, value: unknown): z.ZodSafeParseResult<z.infer<S>> {
  let current = structuredClone(value);
  let parsed = schema.safeParse(current);
  for (let round = 0; round < 25 && !parsed.success; round++) {
    let changed = false;
    const drops: { list: unknown[]; index: number }[] = [];
    for (const issue of parsed.error.issues) {
      const at = issue.path;
      const key = at.at(-1);
      const parent = at.slice(0, -1).reduce<unknown>((node, k) => (node as Record<PropertyKey, unknown>)?.[k as PropertyKey], current);
      const expected = (issue as { expected?: string }).expected;
      if (issue.code === "invalid_type" && expected === "string" && typeof key === "string" && !ID_KEYS.has(key) && parent && typeof parent === "object") {
        (parent as Record<string, unknown>)[key] = "";
        changed = true;
        continue;
      }
      const i = at.findLastIndex((k) => typeof k === "number");
      if (i < 0) continue;
      const list = at.slice(0, i).reduce<unknown>((node, k) => (node as Record<PropertyKey, unknown>)?.[k as PropertyKey], current);
      if (Array.isArray(list)) drops.push({ list, index: at[i] as number });
    }
    // Drop from the end so earlier indexes stay valid; an item with several issues goes once.
    const done = new Map<unknown[], Set<number>>();
    for (const d of drops.sort((a, b) => b.index - a.index)) {
      const indexes = done.get(d.list) ?? new Set<number>();
      if (indexes.has(d.index) || d.index >= d.list.length) continue;
      indexes.add(d.index);
      done.set(d.list, indexes);
      d.list.splice(d.index, 1);
      changed = true;
    }
    if (!changed) break;
    parsed = schema.safeParse(current);
  }
  return parsed;
}

/** Parse the model's text as JSON, tolerating a ```json fence around it. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : text).trim());
}

const RATE_LIMIT_WAITS = [2_000, 4_000, 8_000];

export async function callJson<S extends z.ZodType>(call: JsonCall<S>, deps: ClientDeps = {}): Promise<z.infer<S>> {
  const tap = modelTap.getStore();
  if (tap?.replay) {
    const parsed = salvage(call.schema, tap.replay(call.agent));
    if (!parsed.success) throw new ModelOutputError(`recorded ${call.agent} answer no longer matches the schema: ${z.prettifyError(parsed.error)}`);
    return parsed.data;
  }
  const primary = deps.provider ?? providerConfig();
  const fallback = deps.fallback === undefined ? fallbackProvider(primary) : deps.fallback ?? undefined;
  const budget = deps.budget ?? budgetFromEnv();
  const file = deps.usagePath ?? usageFile();
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const tier = call.tier ?? "fast";

  let provider = primary;
  let model = call.model ?? modelFor(provider.name, tier);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(call.instructions, call.schema) },
    { role: "user", content: call.input },
  ];

  async function post(): Promise<ChatResponse> {
    for (let i = 0; ; i++) {
      let res: Response;
      try {
        res = await doFetch(`${provider.baseUrl}/chat/completions`, {
          method: "POST",
          headers: headers(provider),
          signal: AbortSignal.any([
            ...(call.signal ? [call.signal] : []),
            AbortSignal.timeout(call.timeoutMs ?? (provider.name === "meterless" ? METERLESS_TIMEOUT_MS : 120_000)),
          ]),
          body: JSON.stringify(requestBody(provider, model, messages, call)),
        });
      } catch (error) {
        // The caller cancelling is not a transport problem; our own timeout is.
        if (call.signal?.aborted) throw error;
        throw new TransportError(`${provider.name} not reachable at ${provider.baseUrl}: ${error instanceof Error ? error.message : error}`);
      }
      if (res.status === 429 && i < RATE_LIMIT_WAITS.length) {
        await sleep(RATE_LIMIT_WAITS[i]);
        continue;
      }
      if (!res.ok) {
        const detail = `${provider.name} ${res.status}: ${(await res.text()).slice(0, 300)}`;
        throw res.status >= 400 && res.status < 500 && res.status !== 429 ? new ProviderRejectedError(detail) : new Error(detail);
      }
      return (await res.json()) as ChatResponse;
    }
  }

  let lastError = "no attempt made";
  for (let attempt = 0; attempt < 2; attempt++) {
    call.signal?.throwIfAborted();
    const wait = checkBudget(readUsage(file), budget);
    if (wait > 0) await sleep(wait);

    const started = performance.now();
    let inputTokens = 0;
    let outputTokens = 0;
    let text = "";
    const log = (ok: boolean, error?: string) => {
      call.onUsage?.({ inputTokens, outputTokens, model, provider: provider.name });
      recordUsage({ ts: new Date().toISOString(), provider: provider.name, model, agent: call.agent, inputTokens, outputTokens, ms: Math.round(performance.now() - started), ok, ...(error ? { error: error.slice(0, 300) } : {}) }, file);
    };
    try {
      const data = await post();
      inputTokens = data.usage?.prompt_tokens ?? 0;
      outputTokens = data.usage?.completion_tokens ?? 0;
      const choice = data.choices?.[0];
      text = choice?.message?.content ?? "";
      if (choice?.finish_reason === "length") throw new OutputTooLongError("output hit max_tokens before the JSON finished");
      const parsed = salvage(call.schema, extractJson(text));
      if (!parsed.success) throw new ModelOutputError(`JSON did not match the schema: ${z.prettifyError(parsed.error)}`);
      log(true);
      tap?.record?.(call.agent, parsed.data);
      return parsed.data;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      lastError = error instanceof Error ? error.message : String(error);
      log(false, lastError);
      if (error instanceof ProviderRejectedError) break;
      if (error instanceof OutputTooLongError) throw error;
      // Only a runtime we can't reach falls back; a runtime that answered keeps its answer.
      if (error instanceof TransportError && fallback && provider !== fallback) {
        provider = fallback;
        model = modelFor(fallback.name, tier);
        attempt--;
        continue;
      }
      if (!(error instanceof ModelOutputError) && !(error instanceof SyntaxError)) continue;
      // Repair turn: show the model its own answer and what was wrong with it.
      messages.push({ role: "assistant", content: text.slice(0, 4000) });
      messages.push({ role: "user", content: `That answer was rejected: ${lastError}\nReply again with only the corrected JSON object.` });
    }
  }
  throw new ModelOutputError(`${call.agent}: model call failed after retry: ${lastError}`);
}
