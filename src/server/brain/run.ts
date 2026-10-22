import { z } from "zod";
import type { AgentRunStat } from "../../shared/graph";
import { callJson } from "../../llm/client";
import type { AgentName, BrainOptions } from "./types";

// Output budgets per agent: the Cartographer writes the whole graph in one answer.
const MAX_TOKENS: Record<AgentName, number> = { scout: 6000, reader: 6000, cartographer: 10000, reviewer: 6000, tracer: 2500 };
// Nemotron writes roughly 50-70 tokens a second, so long answers need long timeouts.
const TIMEOUT_MS: Record<AgentName, number> = { scout: 180_000, reader: 180_000, cartographer: 330_000, reviewer: 240_000, tracer: 90_000 };

/**
 * Runs one structured agent call on Nemotron, through Meterless Nightshift when
 * it's configured and NVIDIA directly otherwise. Readers and the Tracer use the
 * fast tier, the rest the deep tier. callJson validates the output against the
 * schema and gives the model one repair turn; stats get one entry per call.
 */
export async function runAgent<S extends z.ZodObject>(
  name: AgentName, instructions: string, schema: S, input: string,
  opts: BrainOptions, stats: AgentRunStat[], statName: string = name,
): Promise<z.infer<S>> {
  opts.signal?.throwIfAborted();
  const started = performance.now();
  const stat: AgentRunStat = { agent: statName, durationMs: 0, inputTokens: 0, outputTokens: 0 };
  try {
    return await callJson({
      agent: statName,
      instructions,
      input,
      schema,
      tier: name === "reader" || name === "tracer" ? "fast" : "deep",
      model: opts.model,
      maxTokens: MAX_TOKENS[name],
      timeoutMs: TIMEOUT_MS[name],
      signal: opts.signal,
      onUsage: (u) => {
        stat.inputTokens = (stat.inputTokens ?? 0) + u.inputTokens;
        stat.outputTokens = (stat.outputTokens ?? 0) + u.outputTokens;
      },
    });
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
