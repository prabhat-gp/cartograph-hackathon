// One structured V2 agent call: Nemotron through the shared client (schema in
// the prompt, zod validation, one repair turn, usage ledger and daily caps).
// Planners ask two tiers at once and keep the first valid answer, as in V1.
import { z } from "zod";
import type { AgentRunStat } from "../../shared/graph";
import type { Tier } from "../../config";
import { callJson } from "../../llm/client";

export type V2Agent = "scout" | "reader" | "cartographer" | "reviewer" | "story-writer";

const TIERS: Record<V2Agent, Tier[]> = { scout: ["mid", "deep"], reader: ["fast"], cartographer: ["mid", "deep"], reviewer: ["mid", "deep"], "story-writer": ["mid", "deep"] };
const MAX_TOKENS: Record<V2Agent, number> = { scout: 4000, reader: 5000, cartographer: 7000, reviewer: 4000, "story-writer": 8000 };
const TIMEOUT_MS: Record<V2Agent, number> = { scout: 180_000, reader: 150_000, cartographer: 300_000, reviewer: 240_000, "story-writer": 300_000 };

/** The model, injectable so tests and offline runs never call a provider. */
export type Asker = (call: { agent: V2Agent; label: string; instructions: string; input: string; schema: z.ZodType; tier: Tier; maxTokens: number; timeoutMs: number; signal?: AbortSignal }) => Promise<unknown>;

export const nemotron: Asker = (call) => callJson({
  agent: `v2:${call.label}`,
  instructions: call.instructions,
  input: call.input,
  schema: call.schema,
  tier: call.tier,
  maxTokens: call.maxTokens,
  timeoutMs: call.timeoutMs,
  signal: call.signal,
});

export interface RunOptions {
  ask?: Asker;
  signal?: AbortSignal;
  stats?: AgentRunStat[];
  onProgress?: (message: string) => void;
}

export async function runV2Agent<S extends z.ZodType>(agent: V2Agent, label: string, instructions: string, schema: S, input: string, opts: RunOptions): Promise<z.infer<S>> {
  opts.signal?.throwIfAborted();
  const ask = opts.ask ?? nemotron;
  const started = performance.now();
  const stat: AgentRunStat = { agent: label, durationMs: 0 };
  try {
    const tiers = TIERS[agent];
    const once = (tier: Tier, signal?: AbortSignal) =>
      ask({ agent, label, instructions, input, schema, tier, maxTokens: MAX_TOKENS[agent], timeoutMs: TIMEOUT_MS[agent], signal }).then((out) => schema.parse(out) as z.infer<S>);
    if (tiers.length === 1) return await once(tiers[0], opts.signal);
    const controllers = tiers.map(() => new AbortController());
    try {
      return await Promise.any(tiers.map((tier, i) => once(tier, AbortSignal.any([controllers[i].signal, ...(opts.signal ? [opts.signal] : [])])).then((answer) => {
        controllers.forEach((c, j) => j !== i && c.abort());
        return answer;
      })));
    } catch (error) {
      throw error instanceof AggregateError ? error.errors[0] : error;
    }
  } finally {
    stat.durationMs = Math.round(performance.now() - started);
    opts.stats?.push(stat);
  }
}

/** Runs `fn` over items with at most `limit` in flight, keeping order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
