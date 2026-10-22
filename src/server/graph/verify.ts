// "Cartograph never draws an arrow it can't cite."
//
// Agents propose edges with evidence (path, line, snippet). This module checks
// every snippet against the actual file contents at the mapped commit, fixes
// slightly-off line numbers, and drops edges with no surviving evidence.
import {
  type CartographEdge,
  type CartographFlow,
  type CartographGraph,
  type CartographNode,
  type Evidence,
  type GraphStats,
  NodeSchema,
  type RepoRef,
  edgeKey,
} from "../../shared/graph";
import type { DraftEdge, DraftGraph } from "../brain/types";
import type { RepoSnapshot } from "../repo";

const MAX_EVIDENCE_PER_EDGE = 5;
const MIN_SNIPPET_CHARS = 6;
const NEAR_WINDOW = 6;

export interface DroppedEdge {
  from: string;
  to: string;
  kind: string;
  label: string;
  reason: "no-evidence" | "unknown-node" | "self-loop";
}

/** Fast lookup over a snapshot's files. */
export class FileIndex {
  private byPath = new Map<string, { raw: string[]; norm: string[] }>();
  private paths: string[];

  constructor(snapshot: Pick<RepoSnapshot, "files">) {
    for (const f of snapshot.files) {
      const raw = f.content.split("\n");
      this.byPath.set(f.path, { raw, norm: raw.map(normalize) });
    }
    this.paths = [...this.byPath.keys()];
  }

  has(path: string): boolean {
    return this.byPath.has(path);
  }

  /** Resolve a possibly sloppy path ("./src/x.ts", "x.ts") to a real one. */
  resolve(p: string): string | undefined {
    const clean = p.trim().replace(/^\.?\/+/, "").replace(/\\/g, "/");
    if (this.byPath.has(clean)) return clean;
    const suffix = this.paths.filter((q) => q.endsWith(`/${clean}`));
    if (suffix.length === 1) return suffix[0];
    return undefined;
  }

  /** Whether `p` is a file or a directory prefix of some file. */
  exists(p: string): boolean {
    const clean = p.trim().replace(/^\.?\/+/, "").replace(/\/+$/, "");
    if (this.resolve(clean)) return true;
    return this.paths.some((q) => q.startsWith(`${clean}/`));
  }

  /** Verify one evidence item; returns the corrected evidence or undefined. */
  verify(ev: Evidence): Evidence | undefined {
    const path = this.resolve(ev.path);
    if (!path) return undefined;
    const file = this.byPath.get(path)!;
    const anchors = snippetAnchors(ev.snippet);
    if (anchors.length === 0) return undefined;

    for (const anchor of anchors) {
      const hit = findLine(file.norm, anchor, ev.line);
      if (hit !== undefined) {
        return { path, line: hit + 1, snippet: file.raw[hit].trim().slice(0, 240) };
      }
    }
    return undefined;
  }
}

/** Collapse whitespace and unify quotes so trivial differences don't fail a match. */
function normalize(s: string): string {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/`/g, "'").replace(/"/g, "'").replace(/\s+/g, " ").trim();
}

/** Lines of the snippet worth matching on, longest first, with any "12| " prefix removed. */
function snippetAnchors(snippet: string): string[] {
  return snippet
    .split("\n")
    .map((l) => normalize(l.replace(/^\s*\d+\s*\|\s?/, "")))
    .filter((l) => l.length >= MIN_SNIPPET_CHARS && !/^[{}()[\];,]+$/.test(l))
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
}

function findLine(norm: string[], anchor: string, hintLine: number): number | undefined {
  const hint = Math.max(0, Math.min(norm.length - 1, hintLine - 1));
  for (let d = 0; d <= NEAR_WINDOW; d++) {
    for (const i of d === 0 ? [hint] : [hint - d, hint + d]) {
      if (i >= 0 && i < norm.length && norm[i].includes(anchor)) return i;
    }
  }
  const i = norm.findIndex((l) => l.includes(anchor));
  return i >= 0 ? i : undefined;
}

/** Stable, readable edge id derived from its semantics, so ids survive re-maps. */
export function stableEdgeId(e: Pick<CartographEdge, "from" | "to" | "kind">): string {
  return `${e.from}--${e.kind}--${e.to}`;
}

function dedupeEvidence(items: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const ev of items) {
    const k = `${ev.path}:${ev.line}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(ev);
  }
  return out.slice(0, MAX_EVIDENCE_PER_EDGE);
}

function mergeLabels(a: string, b: string): string {
  const parts = [...new Set([...a.split(" · "), ...b.split(" · ")].map((s) => s.trim()).filter(Boolean))];
  return parts.length > 3 ? `${parts.slice(0, 3).join(" · ")} +${parts.length - 3}` : parts.join(" · ");
}

export interface VerifiedEdges {
  edges: CartographEdge[];
  /** draft edge id → final edge id */
  idMap: Map<string, string>;
  dropped: DroppedEdge[];
}

/**
 * Verify draft edges against the index. Edges that share from/to/kind are merged
 * (evidence and labels combined) under one stable id.
 */
export function verifyEdges(drafts: DraftEdge[], nodeIds: Set<string>, index: FileIndex): VerifiedEdges {
  const byKey = new Map<string, CartographEdge>();
  const idMap = new Map<string, string>();
  const dropped: DroppedEdge[] = [];

  for (const d of drafts) {
    const base = { from: d.from, to: d.to, kind: d.kind, label: d.label };
    if (d.from === d.to) {
      dropped.push({ ...base, reason: "self-loop" });
      continue;
    }
    if (!nodeIds.has(d.from) || !nodeIds.has(d.to)) {
      dropped.push({ ...base, reason: "unknown-node" });
      continue;
    }
    const evidence = d.evidence.map((ev) => index.verify(ev)).filter((ev): ev is Evidence => !!ev);
    if (evidence.length === 0) {
      dropped.push({ ...base, reason: "no-evidence" });
      continue;
    }
    const key = edgeKey(d);
    const existing = byKey.get(key);
    if (existing) {
      existing.evidence = dedupeEvidence([...existing.evidence, ...evidence]);
      existing.label = mergeLabels(existing.label, d.label);
      idMap.set(d.id, existing.id);
    } else {
      const id = stableEdgeId(d);
      byKey.set(key, { id, from: d.from, to: d.to, kind: d.kind, label: d.label.trim(), evidence: dedupeEvidence(evidence) });
      idMap.set(d.id, id);
    }
  }
  return { edges: [...byKey.values()], idMap, dropped };
}

/** Rewrite flow steps through an id map, dropping steps whose edge vanished. */
export function remapFlows(flows: CartographFlow[], idMap: Map<string, string>, edgeIds: Set<string>): CartographFlow[] {
  const seen = new Set<string>();
  const out: CartographFlow[] = [];
  for (const f of flows) {
    const steps = f.steps
      .map((s) => ({ ...s, edge: idMap.get(s.edge) ?? s.edge }))
      .filter((s) => edgeIds.has(s.edge))
      // a merged edge can appear twice in a row; keep the first
      .filter((s, i, arr) => i === 0 || arr[i - 1].edge !== s.edge);
    if (steps.length === 0) continue;
    let id = slugId(f.id || f.name);
    while (seen.has(id)) id = `${id}-2`;
    seen.add(id);
    out.push({ ...f, id, steps });
  }
  return out;
}

function slugId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "flow";
}

/** Clean up agent-proposed nodes: valid shape, unique ids, real file refs. */
export function cleanNodes(nodes: CartographNode[], index: FileIndex): CartographNode[] {
  const seen = new Set<string>();
  const out: CartographNode[] = [];
  for (const raw of nodes) {
    const parsed = NodeSchema.safeParse(raw);
    if (!parsed.success) continue;
    const n = parsed.data;
    const id = slugId(n.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const files = n.files
      .map((f) => ({ ...f, path: index.resolve(f.path) ?? f.path.replace(/^\.?\/+/, "").replace(/\/+$/, "") }))
      .filter((f) => index.exists(f.path));
    out.push({ ...n, id, files, details: [...new Set(n.details)].slice(0, 12) });
  }
  return out;
}

export interface VerifyMeta {
  repo: RepoRef;
  sha: string;
  branch?: string;
  model: string;
  durationMs: number;
}

export interface VerifyResult {
  graph: CartographGraph;
  dropped: DroppedEdge[];
}

/** Turn an agent DraftGraph into a verified CartographGraph. */
export function verifyDraft(draft: DraftGraph, snapshot: RepoSnapshot, meta: VerifyMeta): VerifyResult {
  const index = new FileIndex(snapshot);

  // Agents sometimes return node ids that need slugging; keep edges pointing at them.
  const idFix = new Map<string, string>();
  for (const n of draft.nodes) idFix.set(n.id, slugId(n.id));
  const fixedEdges = draft.edges.map((e) => ({ ...e, from: idFix.get(e.from) ?? e.from, to: idFix.get(e.to) ?? e.to }));

  let nodes = cleanNodes(draft.nodes, index);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const { edges, idMap, dropped } = verifyEdges(fixedEdges, nodeIds, index);

  // Keep a node if a verified edge touches it, or it is backed by real files.
  const touched = new Set(edges.flatMap((e) => [e.from, e.to]));
  const before = nodes.length;
  nodes = nodes.filter((n) => touched.has(n.id) || n.files.length > 0);
  const nodesDropped = before - nodes.length + (draft.nodes.length - before);

  const flows = remapFlows(draft.flows, idMap, new Set(edges.map((e) => e.id)));

  const stats: GraphStats = {
    files: snapshot.files.length,
    tokens: snapshot.totalTokens,
    edgesProposed: draft.edges.length,
    edgesVerified: edges.length,
    edgesDropped: dropped.length,
    nodesDropped,
    model: meta.model,
    durationMs: meta.durationMs,
    agents: draft.agentStats,
  };

  return {
    graph: {
      version: 1,
      repo: meta.repo,
      sha: meta.sha,
      branch: meta.branch,
      generatedAt: new Date().toISOString(),
      mode: "full",
      stack: draft.stack,
      summary: draft.summary,
      nodes,
      edges,
      flows,
      stats,
    },
    dropped,
  };
}

/**
 * Re-check existing edges after a push. Edges whose evidence lives only in
 * unchanged files are kept as-is; the rest are re-verified against the new
 * snapshot and removed if nothing survives.
 */
export function reverifyEdges(
  edges: CartographEdge[],
  changedPaths: Set<string>,
  index: FileIndex,
): { kept: CartographEdge[]; lost: CartographEdge[] } {
  const kept: CartographEdge[] = [];
  const lost: CartographEdge[] = [];
  for (const e of edges) {
    if (!e.evidence.some((ev) => changedPaths.has(ev.path))) {
      kept.push(e);
      continue;
    }
    const evidence = e.evidence
      .map((ev) => (changedPaths.has(ev.path) ? index.verify(ev) : ev))
      .filter((ev): ev is Evidence => !!ev);
    if (evidence.length > 0) kept.push({ ...e, evidence: dedupeEvidence(evidence) });
    else lost.push(e);
  }
  return { kept, lost };
}
