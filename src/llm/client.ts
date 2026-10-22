// One structured model call over the OpenAI chat completions API, against
// Meterless Nightshift or NVIDIA directly. NVIDIA's strict json_schema mode
// tends to run away (pages of whitespace until max_tokens), so we ask for a
// JSON object, put the schema in the prompt, validate with zod, and give the
// model one repair turn with the exact validation error.
import { z } from "zod";
import { providerConfig, type ProviderConfig } from "../config";
import { budgetFromEnv, checkBudget, readUsage, recordUsage, usageFile, type Budget } from "./usage";

export const DEFAULT_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

export interface JsonCall<S extends z.ZodType> {
  agent: string;
  instructions: string;
  input: string;
  schema: S;
  model?: string;
  maxTokens?: number;
  /** Nemotron reasoning traces cost tokens; off unless an agent needs them. */
  thinking?: boolean;
  signal?: AbortSignal;
}

export interface ClientDeps {
  provider?: ProviderConfig;
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
    h["meterless-app"] = "cartograph";
    h["meterless-scope"] = "user";
  }
  return h;
}

/** Parse the model's text as JSON, tolerating a ```json fence around it. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : text).trim());
}

export async function callJson<S extends z.ZodType>(call: JsonCall<S>, deps: ClientDeps = {}): Promise<z.infer<S>> {
  const provider = deps.provider ?? providerConfig();
  const budget = deps.budget ?? budgetFromEnv();
  const file = deps.usagePath ?? usageFile();
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const model = call.model ?? process.env.CARTOGRAPH_MODEL ?? DEFAULT_MODEL;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(call.instructions, call.schema) },
    { role: "user", content: call.input },
  ];

  let lastError = "no attempt made";
  for (let attempt = 0; attempt < 2; attempt++) {
    call.signal?.throwIfAborted();
    const wait = checkBudget(readUsage(file), budget);
    if (wait > 0) await sleep(wait);

    const started = performance.now();
    let inputTokens = 0;
    let outputTokens = 0;
    let text = "";
    try {
      const res = await doFetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: headers(provider),
        signal: call.signal,
        body: JSON.stringify({
          model,
          messages,
          max_tokens: call.maxTokens ?? 2000,
          temperature: 0.2,
          response_format: { type: "json_object" },
          chat_template_kwargs: { enable_thinking: call.thinking ?? false },
        }),
      });
      if (!res.ok) {
        const detail = `${provider.name} ${res.status}: ${(await res.text()).slice(0, 300)}`;
        throw res.status >= 400 && res.status < 500 && res.status !== 429 ? new ProviderRejectedError(detail) : new Error(detail);
      }
      const data = (await res.json()) as ChatResponse;
      inputTokens = data.usage?.prompt_tokens ?? 0;
      outputTokens = data.usage?.completion_tokens ?? 0;
      const choice = data.choices?.[0];
      text = choice?.message?.content ?? "";
      if (choice?.finish_reason === "length") throw new ModelOutputError("output hit max_tokens before the JSON finished");
      const parsed = call.schema.safeParse(extractJson(text));
      if (!parsed.success) throw new ModelOutputError(`JSON did not match the schema: ${z.prettifyError(parsed.error)}`);
      recordUsage({ ts: new Date().toISOString(), provider: provider.name, model, agent: call.agent, inputTokens, outputTokens, ms: Math.round(performance.now() - started), ok: true }, file);
      return parsed.data;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      lastError = error instanceof Error ? error.message : String(error);
      recordUsage({ ts: new Date().toISOString(), provider: provider.name, model, agent: call.agent, inputTokens, outputTokens, ms: Math.round(performance.now() - started), ok: false, error: lastError.slice(0, 300) }, file);
      if (error instanceof ProviderRejectedError) break;
      if (!(error instanceof ModelOutputError) && !(error instanceof SyntaxError)) {
        if (attempt === 1) break;
        continue;
      }
      // Repair turn: show the model its own answer and what was wrong with it.
      messages.push({ role: "assistant", content: text.slice(0, 4000) });
      messages.push({ role: "user", content: `That answer was rejected: ${lastError}\nReply again with only the corrected JSON object.` });
    }
  }
  throw new ModelOutputError(`${call.agent}: model call failed after retry: ${lastError}`);
}
