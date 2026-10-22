import type { AgentRunStat } from "../../shared/graph";
import { REVIEWER_PROMPT } from "./prompts";
import { runAgent } from "./run";
import { ReviewerSchema } from "./schemas";
import type { BrainOptions, ReviewInput, ReviewResult } from "./types";
import { compactGraph, isSuppliedEvidence, reviewFiles, toNode } from "./util";

export async function reviewChanges(input: ReviewInput, opts: BrainOptions = {}): Promise<ReviewResult> {
  opts.signal?.throwIfAborted();
  const agentStats: AgentRunStat[] = [];
  if (!input.changes.length) {
    return { addNodes: [], addEdges: [], removeEdgeIds: [], findings: [], summary: "No files changed.", agentStats };
  }
  const { entries, supplied, omitted } = reviewFiles(input.changes, input.snapshot.files);
  opts.onProgress?.({ agent: "reviewer", phase: "start", message: `Reviewer · inspecting ${input.changes.length} changed files` });
  const truncated = entries.filter((entry) => entry.truncated).length;
  if (omitted || truncated) opts.onProgress?.({ agent: "reviewer", phase: "progress",
    message: `Reviewer · ${truncated} files truncated, ${omitted} omitted for budget`, data: { truncated, omitted } });
  const result = await runAgent("reviewer", REVIEWER_PROMPT, ReviewerSchema, JSON.stringify({
    graph: compactGraph(input.graph), changes: entries, omittedFiles: omitted,
  }), opts, agentStats);
  const nodeIds = new Set(input.graph.nodes.map((node) => node.id));
  const addNodes = result.addNodes.flatMap((node) => {
    if (nodeIds.has(node.id)) return [];
    nodeIds.add(node.id);
    return [toNode(node)];
  });
  const existingEdges = new Set(input.graph.edges.map((edge) => edge.id));
  const edgeIds = new Set(existingEdges);
  const addEdges = result.addEdges.flatMap((edge) => {
    if (edgeIds.has(edge.id) || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return [];
    const evidence = edge.evidence.filter((item) => isSuppliedEvidence(item, supplied));
    if (!evidence.length) return [];
    edgeIds.add(edge.id);
    return [{ ...edge, evidence }];
  });
  const removeEdgeIds = [...new Set(result.removeEdgeIds)].filter((id) => existingEdges.has(id));
  const rank = { critical: 3, warning: 2, info: 1 };
  const findings = result.findings.map((finding) => ({
    ...finding, nodeIds: finding.nodeIds.filter((id) => nodeIds.has(id)),
    edgeIds: finding.edgeIds.filter((id) => edgeIds.has(id)),
  })).sort((a, b) => rank[b.severity] - rank[a.severity]);
  opts.onProgress?.({ agent: "reviewer", phase: "done",
    message: `Reviewer · ${addEdges.length} new dependencies, ${findings.length} findings`,
    data: { added: addEdges.length, removed: removeEdgeIds.length, findings: findings.length } });
  return { addNodes, addEdges, removeEdgeIds, findings, summary: result.summary, agentStats };
}
