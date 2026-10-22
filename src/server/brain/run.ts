import { Agent, run, setTracingDisabled } from "@openai/agents";
import { z } from "zod";
import type { AgentRunStat } from "../../shared/graph";
import { codexRuntime, runCodex } from "./codex";
import type { AgentName, BrainOptions } from "./types";

// Without an API key the agents run on Codex; the SDK has nowhere to send traces.
if (codexRuntime()) setTracingDisabled(true);

/** Runs a structured agent with one retry. Stats include each attempted call. */
export async function runAgent<S extends z.ZodObject>(
  name: AgentName, instructions: string, schema: S, input: string,
  opts: BrainOptions, stats: AgentRunStat[], statName: string = name,
): Promise<z.infer<S>> {
  const model = opts.model ?? process.env.CARTOGRAPH_MODEL ?? "gpt-6.1-sol";
  const effort = name === "reader" || name === "tracer" ? "low" : "medium";
  const useCodex = codexRuntime();
  const agent = useCodex
    ? undefined
    : new Agent({ name: `Cartograph ${name}`, instructions, outputType: schema, model, modelSettings: { reasoning: { effort } } });
  for (let attempt = 0; attempt < 2; attempt++) {
    opts.signal?.throwIfAborted();
    const started = performance.now();
    const stat: AgentRunStat = { agent: statName, durationMs: 0 };
    try {
      if (useCodex) {
        const output = await runCodex({
          instructions, input, schema, model, effort, signal: opts.signal,
          onUsage: (u) => {
            stat.inputTokens = u.inputTokens;
            stat.outputTokens = u.outputTokens;
          },
        });
        return schema.parse(output);
      }
      const result = await run(agent!, input, { signal: opts.signal });
      const usage = result.runContext.usage;
      stat.inputTokens = usage.inputTokens;
      stat.outputTokens = usage.outputTokens;
      return schema.parse(result.finalOutput);
    } catch (error) {
      opts.signal?.throwIfAborted();
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (attempt === 1) throw error;
      opts.onProgress?.({ agent: name, phase: "progress", message: `${name} · retrying failed call` });
    } finally {
      stat.durationMs = Math.round(performance.now() - started);
      stats.push(stat);
    }
  }
  throw new Error("Agent retry limit reached");
}
