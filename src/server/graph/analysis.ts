// Deterministic graph analysis: no model calls, instant and repeatable.
// Blast radius, commit-to-commit diffs, architecture rules and flow rendering.
import {
  type CartographEdge,
  type CartographFlow,
  type CartographGraph,
  type CartographNode,
  type DriftFinding,
  type NodeKind,
  type Severity,
  edgeKey,
} from "../../shared/graph";

export function nodeMap(graph: Pick<CartographGraph, "nodes">): Map<string, CartographNode> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

/** Find a node by id, label or fuzzy text ("redis", "Orders API"). */
export function findNode(graph: CartographGraph, query: string): CartographNode | undefined {
  const q = query.trim().toLowerCase();
  const exact = graph.nodes.find((n) => n.id === q || n.label.toLowerCase() === q);
  if (exact) return exact;
  const words = q.split(/[^a-z0-9]+/).filter(Boolean);
  let best: { node: CartographNode; score: number } | undefined;
  for (const n of graph.nodes) {
    const hay = `${n.id} ${n.label} ${n.tech ?? ""} ${n.kind}`.toLowerCase();
    const score = words.filter((w) => hay.includes(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { node: n, score };
  }
  return best?.node;
}

// ---------------------------------------------------------------- blast radius

export interface BlastRadius {
  node: CartographNode;
  /** Components that (transitively) depend on the failed one, nearest first. */
  impacted: Array<{ node: CartographNode; depth: number; via: string }>;
  /** Edges that stop working: into the failed node and along the impact chain. */
  edgeIds: string[];
  /** Flows with a step that touches the failed node. */
  brokenFlows: CartographFlow[];
  summary: string;
}

/**
 * "What breaks if X dies?" Edges point actor → dependency, so everything that
 * reaches X by following edges backwards is impacted.
 */
export function blastRadius(graph: CartographGraph, nodeId: string): BlastRadius | undefined {
  const nodes = nodeMap(graph);
  const root = nodes.get(nodeId);
  if (!root) return undefined;

  const incoming = new Map<string, CartographEdge[]>();
  for (const e of graph.edges) {
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to)!.push(e);
  }

  const depth = new Map<string, number>([[nodeId, 0]]);
  const via = new Map<string, string>();
  const edgeIds = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of incoming.get(cur) ?? []) {
      edgeIds.add(e.id);
      if (depth.has(e.from)) continue;
      depth.set(e.from, depth.get(cur)! + 1);
      via.set(e.from, e.id);
      queue.push(e.from);
    }
  }

  const impacted = [...depth.entries()]
    .filter(([id]) => id !== nodeId)
    .map(([id, d]) => ({ node: nodes.get(id)!, depth: d, via: via.get(id)! }))
    .sort((a, b) => a.depth - b.depth || a.node.label.localeCompare(b.node.label));

  const touching = new Set(graph.edges.filter((e) => e.from === nodeId || e.to === nodeId).map((e) => e.id));
  const brokenFlows = graph.flows.filter((f) => f.steps.some((s) => touching.has(s.edge)));

  const direct = impacted.filter((i) => i.depth === 1).map((i) => i.node.label);
  const summary =
    impacted.length === 0
      ? `Nothing in the map depends on ${root.label}.`
      : `If ${root.label} goes down, ${impacted.length} component${impacted.length === 1 ? "" : "s"} ` +
        `${impacted.length === 1 ? "is" : "are"} affected (directly: ${direct.join(", ")})` +
        (brokenFlows.length ? ` and ${brokenFlows.length} flow${brokenFlows.length === 1 ? "" : "s"} break: ${brokenFlows.map((f) => f.name).join(", ")}.` : ".");

  return { node: root, impacted, edgeIds: [...edgeIds], brokenFlows, summary };
}

// ---------------------------------------------------------------- diff

export interface GraphDiff {
  addedNodes: CartographNode[];
  removedNodes: CartographNode[];
  addedEdges: CartographEdge[];
  removedEdges: CartographEdge[];
}

export function diffGraphs(before: CartographGraph, after: CartographGraph): GraphDiff {
  const beforeNodes = new Set(before.nodes.map((n) => n.id));
  const afterNodes = new Set(after.nodes.map((n) => n.id));
  const beforeEdges = new Set(before.edges.map(edgeKey));
  const afterEdges = new Set(after.edges.map(edgeKey));
  return {
    addedNodes: after.nodes.filter((n) => !beforeNodes.has(n.id)),
    removedNodes: before.nodes.filter((n) => !afterNodes.has(n.id)),
    addedEdges: after.edges.filter((e) => !beforeEdges.has(edgeKey(e))),
    removedEdges: before.edges.filter((e) => !afterEdges.has(edgeKey(e))),
  };
}

export function isEmptyDiff(d: GraphDiff): boolean {
  return !d.addedNodes.length && !d.removedNodes.length && !d.addedEdges.length && !d.removedEdges.length;
}

// ---------------------------------------------------------------- rules

const DATA_KINDS = new Set<NodeKind>(["database", "cache", "queue", "storage"]);
const CLIENT_KINDS = new Set<NodeKind>(["frontend", "client"]);

type RuleFinding = Omit<DriftFinding, "id">;

/** Architecture rules applied to what a push changed. */
export function ruleFindings(before: CartographGraph, after: CartographGraph, diff: GraphDiff): RuleFinding[] {
  const nodes = new Map([...nodeMap(before), ...nodeMap(after)]);
  const out: RuleFinding[] = [];
  const label = (id: string) => nodes.get(id)?.label ?? id;
  const where = (e: CartographEdge) => (e.evidence[0] ? ` (${e.evidence[0].path}:${e.evidence[0].line})` : "");

  for (const e of diff.addedEdges) {
    const from = nodes.get(e.from);
    const to = nodes.get(e.to);
    if (!from || !to) continue;
    if (CLIENT_KINDS.has(from.kind) && DATA_KINDS.has(to.kind)) {
      out.push({
        severity: "critical",
        rule: "layering.client-to-data",
        title: `${from.label} now talks to ${to.label} directly`,
        detail:
          `New ${e.kind} dependency${where(e)} bypasses the API layer: the API's auth, validation and ` +
          `caching no longer apply, and the ${from.kind} tier now needs ${to.kind} credentials.`,
        nodeIds: [from.id, to.id],
        edgeIds: [e.id],
        source: "rule",
      });
    } else if (CLIENT_KINDS.has(from.kind) && to.kind === "external" && e.kind === "sdk") {
      out.push({
        severity: "warning",
        rule: "layering.client-to-third-party",
        title: `${from.label} calls ${to.label} from the client`,
        detail: `Third-party SDK used in client code${where(e)}. Make sure no secret keys are shipped to the browser.`,
        nodeIds: [from.id, to.id],
        edgeIds: [e.id],
        source: "rule",
      });
    }
  }

  for (const n of diff.addedNodes) {
    if (n.kind === "external") {
      out.push({
        severity: "info",
        rule: "dependency.new-third-party",
        title: `New third-party dependency: ${n.label}`,
        detail: `${n.summary}`.trim() || `The system now depends on ${n.label}.`,
        nodeIds: [n.id],
        edgeIds: diff.addedEdges.filter((e) => e.to === n.id || e.from === n.id).map((e) => e.id),
        source: "rule",
      });
    } else if (DATA_KINDS.has(n.kind)) {
      out.push({
        severity: "warning",
        rule: "dependency.new-datastore",
        title: `New ${n.kind}: ${n.label}`,
        detail: `A new piece of infrastructure to run, back up and monitor. ${n.summary}`.trim(),
        nodeIds: [n.id],
        edgeIds: diff.addedEdges.filter((e) => e.to === n.id).map((e) => e.id),
        source: "rule",
      });
    }
  }

  // Flows that lost a step.
  const removed = new Set(diff.removedEdges.map((e) => e.id));
  for (const f of before.flows) {
    const lostSteps = f.steps.filter((s) => removed.has(s.edge));
    if (lostSteps.length === 0) continue;
    out.push({
      severity: "warning",
      rule: "flow.changed",
      title: `"${f.name}" flow changed`,
      detail: `${lostSteps.length} step${lostSteps.length === 1 ? "" : "s"} of this flow no longer exist: ${lostSteps
        .map((s) => {
          const e = before.edges.find((x) => x.id === s.edge);
          return e ? `${label(e.from)} → ${label(e.to)}` : s.edge;
        })
        .join(", ")}.`,
      nodeIds: [],
      edgeIds: lostSteps.map((s) => s.edge),
      source: "rule",
    });
  }

  // New dependency cycles between our own components.
  for (const e of diff.addedEdges) {
    if (e.kind === "consume" || e.kind === "webhook") continue;
    const path = findPath(after, e.to, e.from);
    if (path) {
      out.push({
        severity: "warning",
        rule: "coupling.cycle",
        title: `New dependency cycle: ${[e.from, ...path].map(label).join(" → ")}`,
        detail: "Cycles make components impossible to deploy, test or reason about independently.",
        nodeIds: [e.from, ...path],
        edgeIds: [e.id],
        source: "rule",
      });
    }
  }

  return out;
}

/** Shortest path over call-like edges, as node ids [from, …, to]. */
function findPath(graph: CartographGraph, from: string, to: string): string[] | undefined {
  const out = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.kind === "consume" || e.kind === "webhook") continue;
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from)!.push(e.to);
  }
  const prev = new Map<string, string>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) {
      const path = [to];
      for (let p = to; p !== from; ) {
        p = prev.get(p)!;
        path.unshift(p);
      }
      return path;
    }
    for (const next of out.get(cur) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, cur);
      queue.push(next);
    }
  }
  return undefined;
}

export function maxSeverity(findings: Array<{ severity: Severity }>): Severity | "none" {
  if (findings.some((f) => f.severity === "critical")) return "critical";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  if (findings.length) return "info";
  return "none";
}

// ---------------------------------------------------------------- flows

export interface FlowStepView {
  index: number;
  edgeId: string;
  from: { id: string; label: string; kind: NodeKind };
  to: { id: string; label: string; kind: NodeKind };
  kind: CartographEdge["kind"];
  label: string;
  note: string;
  evidence: CartographEdge["evidence"][number] | undefined;
}

export interface FlowView {
  id: string;
  name: string;
  trigger: string;
  description: string;
  steps: FlowStepView[];
}

export function flowView(graph: CartographGraph, flow: CartographFlow): FlowView {
  const nodes = nodeMap(graph);
  const edges = new Map(graph.edges.map((e) => [e.id, e]));
  const steps: FlowStepView[] = [];
  flow.steps.forEach((s) => {
    const e = edges.get(s.edge);
    if (!e) return;
    const from = nodes.get(e.from);
    const to = nodes.get(e.to);
    if (!from || !to) return;
    steps.push({
      index: steps.length + 1,
      edgeId: e.id,
      from: { id: from.id, label: from.label, kind: from.kind },
      to: { id: to.id, label: to.label, kind: to.kind },
      kind: e.kind,
      label: e.label,
      note: s.note,
      evidence: e.evidence[0],
    });
  });
  return { id: flow.id, name: flow.name, trigger: flow.trigger, description: flow.description, steps };
}

/** Plain-text walk-through of a flow, for the model to narrate. */
export function flowText(view: FlowView): string {
  return [
    `Flow: ${view.name} (trigger: ${view.trigger})`,
    ...view.steps.map(
      (s) =>
        `${s.index}. ${s.from.label} → ${s.to.label} [${s.kind}: ${s.label}]: ${s.note}` +
        (s.evidence ? ` (${s.evidence.path}:${s.evidence.line})` : ""),
    ),
  ].join("\n");
}

/** Cheap keyword match of a question against existing flows. */
export function matchFlow(graph: CartographGraph, question: string): CartographFlow | undefined {
  const stop = new Set(["what", "happens", "when", "how", "does", "the", "a", "an", "is", "do", "i", "user", "someone", "to", "of", "in", "on", "and", "flow", "work", "works"]);
  const words = question.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !stop.has(w));
  let best: { flow: CartographFlow; score: number } | undefined;
  for (const f of graph.flows) {
    const hay = `${f.id} ${f.name} ${f.trigger} ${f.description}`.toLowerCase();
    const score = words.filter((w) => hay.includes(w) || hay.includes(w.replace(/s$/, ""))).length;
    if (score > 0 && (!best || score > best.score)) best = { flow: f, score };
  }
  return best && best.score >= Math.min(2, words.length) ? best.flow : undefined;
}

// ---------------------------------------------------------------- summaries

export function graphSummary(graph: CartographGraph) {
  const kinds: Record<string, number> = {};
  for (const n of graph.nodes) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
  return {
    repoKey: graph.repo.key,
    repo: graph.repo.name,
    sha: graph.sha,
    generatedAt: graph.generatedAt,
    stack: graph.stack,
    summary: graph.summary,
    components: graph.nodes.length,
    dependencies: graph.edges.length,
    flows: graph.flows.map((f) => ({ id: f.id, name: f.name })),
    kinds,
    verified: { proposed: graph.stats.edgesProposed, verified: graph.stats.edgesVerified, dropped: graph.stats.edgesDropped },
  };
}

/** Compact text description of the whole graph, for model consumption. */
export function graphText(graph: CartographGraph): string {
  const nodes = nodeMap(graph);
  const lines = [
    `${graph.repo.name} @ ${graph.sha.slice(0, 7)}: ${graph.summary}`,
    `Stack: ${graph.stack.join(", ")}`,
    `Components (${graph.nodes.length}): ${graph.nodes.map((n) => `${n.label} [${n.kind}]`).join("; ")}`,
    `Dependencies (${graph.edges.length}, every one cited from code):`,
    ...graph.edges.map((e) => `- ${nodes.get(e.from)?.label} → ${nodes.get(e.to)?.label} (${e.kind}: ${e.label})`),
    `Flows: ${graph.flows.map((f) => f.name).join("; ")}`,
  ];
  return lines.join("\n");
}
