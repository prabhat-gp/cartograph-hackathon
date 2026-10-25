import { z } from "zod";
import type { AgentRunStat } from "../../shared/graph";
import { callJson } from "../../llm/client";
import type { Tier } from "../../config";
import type { AgentName, BrainOptions } from "./types";

// Output budgets per agent: the Cartographer writes the whole graph in one answer.
const MAX_TOKENS: Record<AgentName, number> = { scout: 6000, reader: 6000, cartographer: 8000, reviewer: 6000, tracer: 2500 };
// Readers and the Tracer read in bulk (Lightning). The Scout, Cartographer and
// Reviewer plan and draw: they ask Super and Ultra at once and keep the first
// valid answer. Super is about 3x faster, but NVIDIA's free tier sometimes
// queues it for over a minute; Ultra is slower and steady.
const TIERS: Record<AgentName, Tier[]> = { scout: ["mid", "deep"], reader: ["fast"], cartographer: ["mid", "deep"], reviewer: ["mid", "deep"], tracer: ["fast"] };
// Nemotron writes roughly 30-100 tokens a second, so long answers need long timeouts.
const TIMEOUT_MS: Record<AgentName, number> = { scout: 180_000, reader: 120_000, cartographer: 300_000, reviewer: 240_000, tracer: 90_000 };

/**
 * Runs one structured agent call on Nemotron, through Meterless Nightshift when
 * it's configured and NVIDIA directly otherwise. callJson validates the output
 * against the schema and gives the model one repair turn; stats get one entry
 * per agent, counting every model it asked.
 */
export async function runAgent<S extends z.ZodObject>(
  name: AgentName, instructions: string, schema: S, input: string,
  opts: BrainOptions, stats: AgentRunStat[], statName: string = name,
): Promise<z.infer<S>> {
  opts.signal?.throwIfAborted();
  const started = performance.now();
  const stat: AgentRunStat = { agent: statName, durationMs: 0, inputTokens: 0, outputTokens: 0 };
  const ask = (tier: Tier, signal?: AbortSignal) => callJson({
    agent: statName,
    instructions,
    input,
    schema,
    tier,
    model: opts.model,
    maxTokens: MAX_TOKENS[name],
    timeoutMs: TIMEOUT_MS[name],
    signal,
    onUsage: (u) => {
      stat.inputTokens = (stat.inputTokens ?? 0) + u.inputTokens;
      stat.outputTokens = (stat.outputTokens ?? 0) + u.outputTokens;
    },
  });
  try {
    const tiers = opts.model ? [TIERS[name][0]] : TIERS[name];
    if (tiers.length === 1) return await ask(tiers[0], opts.signal);
    // First valid answer wins; the other request is cancelled.
    const losers = tiers.map(() => new AbortController());
    const signals = losers.map((c) => AbortSignal.any([c.signal, ...(opts.signal ? [opts.signal] : [])]));
    try {
      return await Promise.any(tiers.map((tier, i) => ask(tier, signals[i]).then((answer) => {
        losers.forEach((c, j) => j !== i && c.abort());
        return answer;
      })));
    } catch (error) {
      throw error instanceof AggregateError ? error.errors[0] : error;
    }
  } catch (error) {
    opts.signal?.throwIfAborted();
    if (error instanceof Error && error.name !== "AbortError") {
      opts.onProgress?.({ agent: name, phase: "progress", message: `${name} · model call failed: ${error.message.slice(0, 120)}` });
    }
    throw error;
  } finally {
    stat.durationMs = Math.round(performance.now() - started);
    stats.push(stat);
  }
}
