import { withTrace } from "@openai/agents";
import type { AgentRunStat } from "../../shared/graph";
import { TRACER_PROMPT } from "./prompts";
import { runAgent } from "./run";
import { TracerSchema } from "./schemas";
import type { BrainOptions, TraceInput, TraceResult } from "./types";
import { cleanFlows, compactGraph } from "./util";

export async function traceQuestion(input: TraceInput, opts: BrainOptions = {}): Promise<TraceResult> {
  return withTrace(`Cartograph · trace · ${input.graph.repo.name}`, async () => {
    opts.signal?.throwIfAborted();
    const agentStats: AgentRunStat[] = [];
    opts.onProgress?.({ agent: "tracer", phase: "start", message: "Tracer · following graph dependencies" });
    const result = await runAgent("tracer", TRACER_PROMPT, TracerSchema, JSON.stringify({
      graph: compactGraph(input.graph, true), question: input.question,
    }), opts, agentStats);
    const flowId = input.graph.flows.some((flow) => flow.id === result.flowId) ? result.flowId : null;
    const flow = flowId === null && result.flow ? cleanFlows([result.flow], input.graph.edges)[0] ?? null : null;
    const answer = flowId === null && flow === null && (result.flow !== null || result.flowId !== null)
      ? "The graph does not contain the dependencies needed to trace this question. No supported flow could be resolved."
      : result.answer;
    opts.onProgress?.({ agent: "tracer", phase: "done",
      message: flowId ? "Tracer · found existing flow" : flow ? `Tracer · ${flow.steps.length} steps` : "Tracer · no supported flow" });
    return { flowId, flow, answer, agentStats };
  });
}
