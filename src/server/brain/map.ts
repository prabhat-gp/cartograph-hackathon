import type { AgentRunStat } from "../../shared/graph";
import type { RepoSnapshot } from "../repo";
import { CARTOGRAPHER_PROMPT, READER_PROMPT, SCOUT_PROMPT } from "./prompts";
import { runAgent } from "./run";
import { CartographerSchema, ReaderSchema, ScoutSchema, type ReaderOutput } from "./schemas";
import type { BrainOptions, DraftGraph } from "./types";
import {
  budgetGroups, cleanFlows, concurrentMap, fallbackGroups, mergeComponents,
  mergeReaderEdges, numberReaderEdges, remapEdges, renderFiles, scoutInput, toNode,
} from "./util";

export async function mapRepository(snapshot: RepoSnapshot, opts: BrainOptions = {}): Promise<DraftGraph> {
  opts.signal?.throwIfAborted();
  const agentStats: AgentRunStat[] = [];
  const progress = opts.onProgress;
  progress?.({ agent: "scout", phase: "start", message: `Scout · inspecting ${snapshot.tree.length} paths` });
  let scout;
  try {
    scout = await runAgent("scout", SCOUT_PROMPT, ScoutSchema, scoutInput(snapshot), opts, agentStats);
    progress?.({ agent: "scout", phase: "done", message: `Scout · found ${scout.stack.join(", ") || "repository components"}`,
      data: { components: scout.components.length, groups: scout.readerGroups.length } });
  } catch (error) {
    opts.signal?.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    progress?.({ agent: "scout", phase: "error", message: "Scout · failed; grouping files by directory" });
    scout = { stack: [], summary: "", components: [], readerGroups: fallbackGroups(snapshot.files), flowHints: [] };
  }
  const { groups, skipped } = budgetGroups(scout.readerGroups, snapshot.files);
  progress?.({ agent: "pipeline", phase: "progress",
    message: `Readers · ${groups.length} groups, ${snapshot.files.length - skipped} files${skipped ? `, ${skipped} skipped for budget` : ""}`,
    data: { groups: groups.length, skipped } });
  const files = new Map(snapshot.files.map((file) => [file.path, file]));
  const outputs = await concurrentMap(groups, 4, async (group, index): Promise<ReaderOutput> => {
    opts.signal?.throwIfAborted();
    const label = `Reader ${index + 1}/${groups.length} · ${group.name}`;
    progress?.({ agent: "reader", phase: "start", message: `${label} · ${group.files.length} files` });
    // Each reader sees the same original catalog; discoveries are merged after all finish.
    const input = `${JSON.stringify({ repo: snapshot.repo.name, catalog: scout.components, focus: group.focus })}\n\n${renderFiles(group.files.map((path) => files.get(path)!))}`;
    try {
      const output = await runAgent("reader", READER_PROMPT, ReaderSchema, input, opts, agentStats, `reader:${group.name}`);
      progress?.({ agent: "reader", phase: "done", message: `${label} · ${output.edges.length} dependencies`,
        data: { edges: output.edges.length, components: output.newComponents.length } });
      return output;
    } catch (error) {
      opts.signal?.throwIfAborted();
      if (error instanceof Error && error.name === "AbortError") throw error;
      progress?.({ agent: "reader", phase: "error", message: `${label} · failed after retry; skipped` });
      return { edges: [], newComponents: [], componentNotes: [] };
    }
  });
  opts.signal?.throwIfAborted();
  const catalog = mergeComponents([...scout.components, ...outputs.flatMap((output) => output.newComponents)]);
  const merged = mergeReaderEdges(numberReaderEdges(outputs));
  progress?.({ agent: "cartographer", phase: "start", message: `Cartographer · organizing ${merged.length} dependencies` });
  const result = await runAgent("cartographer", CARTOGRAPHER_PROMPT, CartographerSchema, JSON.stringify({
    repo: snapshot.repo.name, catalog, summary: scout.summary, stack: scout.stack,
    flowHints: scout.flowHints,
    edges: merged.map(({ evidence: _, ...edge }) => edge),
    notes: outputs.flatMap((output) => output.componentNotes),
  }), opts, agentStats);
  const nodes = [...new Map(result.nodes.map((node) => [node.id, toNode(node)])).values()];
  const { edges, redirect } = remapEdges(merged, nodes, result.aliases);
  const flows = cleanFlows(result.flows.map((flow) => ({
    ...flow, steps: flow.steps.map((step) => ({ ...step, edge: redirect.get(step.edge) ?? step.edge })),
  })), edges);
  progress?.({ agent: "cartographer", phase: "done", message: `Cartographer · ${nodes.length} components, ${edges.length} dependencies, ${flows.length} flows`,
    data: { nodes: nodes.length, edges: edges.length, flows: flows.length } });
  return { nodes, edges, flows, summary: result.summary, stack: result.stack, agentStats };
}
