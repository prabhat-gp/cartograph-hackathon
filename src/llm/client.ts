// One structured model call over the OpenAI chat completions API, against
// Meterless Nightshift or NVIDIA directly. NVIDIA's strict json_schema mode
// tends to run away (pages of whitespace until max_tokens), so we ask for a
// JSON object, put the schema in the prompt, validate with zod, and give the
// model one repair turn with the exact validation error.
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

export class ModelOutputError extends Error {
  override name = "ModelOutputError";
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

/** Parse the model's text as JSON, tolerating a ```json fence around it. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : text).trim());
}

const RATE_LIMIT_WAITS = [2_000, 4_000, 8_000];

export async function callJson<S extends z.ZodType>(call: JsonCall<S>, deps: ClientDeps = {}): Promise<z.infer<S>> {
  const primary = deps.provider ?? providerConfig();
  const fallback = deps.fallback === undefined ? fallbackProvider(primary) : deps.fallback ?? undefined;
  const budget = deps.budget ?? budgetFromEnv();
  const file = deps.usagePath ?? usageFile();
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const tier = call.tier ?? "fast";

  let provider = primary;
  let model = call.model ?? process.env.CARTOGRAPH_MODEL ?? modelFor(provider.name, tier);

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
          signal: call.signal ?? AbortSignal.timeout(provider.name === "meterless" ? METERLESS_TIMEOUT_MS : 120_000),
          body: JSON.stringify(requestBody(provider, model, messages, call)),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
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
    const log = (ok: boolean, error?: string) =>
      recordUsage({ ts: new Date().toISOString(), provider: provider.name, model, agent: call.agent, inputTokens, outputTokens, ms: Math.round(performance.now() - started), ok, ...(error ? { error: error.slice(0, 300) } : {}) }, file);
    try {
      const data = await post();
      inputTokens = data.usage?.prompt_tokens ?? 0;
      outputTokens = data.usage?.completion_tokens ?? 0;
      const choice = data.choices?.[0];
      text = choice?.message?.content ?? "";
      if (choice?.finish_reason === "length") throw new ModelOutputError("output hit max_tokens before the JSON finished");
      const parsed = call.schema.safeParse(extractJson(text));
      if (!parsed.success) throw new ModelOutputError(`JSON did not match the schema: ${z.prettifyError(parsed.error)}`);
      log(true);
      return parsed.data;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      lastError = error instanceof Error ? error.message : String(error);
      log(false, lastError);
      if (error instanceof ProviderRejectedError) break;
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
