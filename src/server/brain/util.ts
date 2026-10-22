import type { CartographEdge, CartographFlow, CartographGraph, CartographNode, Evidence } from "../../shared/graph";
import { numberLines, type ChangedFile, type RepoFile, type RepoSnapshot } from "../repo";
import type { Component, ReaderGroup, ReaderOutput, StructuredNode } from "./schemas";

export const READER_GROUP_TOKENS = 60_000;
export const READER_TOTAL_TOKENS = 350_000;

/** Deterministic fallback: group by top-level directory, merging small roots. */
export function fallbackGroups(files: RepoFile[]): ReaderGroup[] {
  const roots = new Map<string, string[]>();
  for (const file of files) {
    const root = file.path.includes("/") ? file.path.split("/")[0] : "root";
    const paths = roots.get(root) ?? [];
    paths.push(file.path);
    roots.set(root, paths);
  }
  const groups = [...roots].sort(([a], [b]) => a.localeCompare(b)).map(([name, paths]) => ({
    name, focus: `Runtime architecture and dependencies in ${name}`, files: paths,
  }));
  if (groups.length <= 6) return groups;
  return [...groups.slice(0, 5), {
    name: "other", focus: "Runtime dependencies in remaining directories",
    files: groups.slice(5).flatMap((group) => group.files),
  }];
}

function filePriority(path: string): number {
  if (/(^|\/)(routes?|controllers?|services?|workers?|jobs?|db|database|config)(\/|[.-])/i.test(path)) return 3;
  if (/(^|\/)(index|main|server|app|Dockerfile|package\.json|schema\.prisma|\.env\.example)(\.|$)/i.test(path)) return 3;
  if (/(^|\/)(test|tests|docs|examples)(\/|$)|\.(test|spec)\./i.test(path)) return 0;
  return 1;
}

/** Repair unknown/duplicate assignments, cover omitted files, and enforce both budgets.
 * Whole files are retained so original line numbers remain valid. */
export function budgetGroups(
  proposed: ReaderGroup[], files: RepoFile[], totalLimit = READER_TOTAL_TOKENS,
  groupLimit = READER_GROUP_TOKENS,
): { groups: ReaderGroup[]; skipped: number } {
  const available = new Map(files.map((file) => [file.path, file]));
  const assignments = new Map<string, ReaderGroup>();
  for (const group of proposed) {
    for (const path of group.files) {
      if (available.has(path) && !assignments.has(path)) assignments.set(path, group);
    }
  }
  for (const group of fallbackGroups(files)) {
    for (const path of group.files) if (!assignments.has(path)) assignments.set(path, group);
  }
  const bins: Array<{ group: ReaderGroup; source: ReaderGroup; tokens: number }> = [];
  let total = 0;
  let skipped = 0;
  const ranked = [...available.values()].sort((a, b) =>
    filePriority(b.path) - filePriority(a.path) || a.tokens - b.tokens || a.path.localeCompare(b.path));
  for (const file of ranked) {
    const tokens = Math.max(file.tokens, Math.ceil(file.content.length / 4));
    if (tokens > groupLimit || total + tokens > totalLimit) { skipped++; continue; }
    const source = assignments.get(file.path)!;
    let bin = bins.find((entry) => entry.source === source && entry.tokens + tokens <= groupLimit);
    if (!bin && bins.length < 6) {
      const part = bins.filter((entry) => entry.source === source).length + 1;
      bin = { source, tokens: 0, group: {
        name: part === 1 ? source.name : `${source.name}-${part}`,
        focus: source.focus, files: [],
      } };
      bins.push(bin);
    }
    // At six groups, use spare capacity rather than dropping relevant files.
    bin ??= bins.find((entry) => entry.tokens + tokens <= groupLimit);
    if (!bin) { skipped++; continue; }
    bin.group.files.push(file.path);
    bin.tokens += tokens;
    total += tokens;
  }
  // Give small repositories two independently readable groups when possible.
  if (bins.length === 1 && bins[0].group.files.length > 1) {
    const bin = bins[0];
    const files = bin.group.files.splice(Math.ceil(bin.group.files.length / 2));
    bins.push({ source: bin.source, tokens: 0, group: {
      name: `${bin.group.name}-2`, focus: bin.group.focus, files,
    } });
  }
  return { groups: bins.map((bin) => bin.group), skipped };
}

export function renderFiles(files: RepoFile[]): string {
  return files.map((file) => `=== ${file.path} ===\n${numberLines(file.content)}`).join("\n\n");
}

export function scoutInput(snapshot: RepoSnapshot): string {
  const config = snapshot.files.filter((file) =>
    /(^|\/)(package\.json|Dockerfile(?:\.[^/]*)?|(?:docker-)?compose[^/]*\.ya?ml|\.env\.example|schema\.prisma|README(?:\.md)?|requirements\.txt|pyproject\.toml|go\.mod|Cargo\.toml|Gemfile|pom\.xml|build\.gradle)$/i.test(file.path)
    || /(?:config\.[^/]+|\.config\.[^/]+|serverless\.ya?ml|vercel\.json|netlify\.toml|fly\.toml|render\.yaml|wrangler\.toml)$/i.test(file.path));
  return JSON.stringify({
    repo: snapshot.repo.name, tree: snapshot.tree.slice(0, 2500),
    omittedPaths: Math.max(0, snapshot.tree.length - 2500),
    files: snapshot.files.map(({ path, tokens }) => ({ path, tokens })),
    manifests: config.map((file) => ({ path: file.path, content:
      /(^|\/)README(?:\.md)?$/i.test(file.path) ? file.content.split("\n").slice(0, 120).join("\n") : file.content })),
  });
}

export function toNode(node: StructuredNode): CartographNode {
  return {
    ...node, tech: node.tech ?? undefined,
    files: node.files.map((file) => file.line === null ? { path: file.path } : { path: file.path, line: file.line }),
  };
}

export function mergeComponents(components: Component[]): Component[] {
  const merged = new Map<string, Component>();
  for (const component of components) {
    const previous = merged.get(component.id);
    merged.set(component.id, previous ? {
      ...previous, tech: previous.tech ?? component.tech,
      paths: [...new Set([...previous.paths, ...component.paths])],
    } : { ...component, paths: [...new Set(component.paths)] });
  }
  return [...merged.values()];
}

export type NumberedReaderEdge = ReaderOutput["edges"][number] & { id: string };
export function numberReaderEdges(outputs: ReaderOutput[]): NumberedReaderEdge[] {
  return outputs.flatMap((output) => output.edges).map((edge, i) => ({ ...edge, id: `r${i + 1}` }));
}

/**
 * Merges the readers' edges into the map's dependencies, in code: one edge per
 * from → to, kind and label, with the union of their evidence (by path and
 * line). Evidence only ever comes from the readers.
 */
export function mergeReaderEdges(readers: NumberedReaderEdge[]): CartographEdge[] {
  const merged = new Map<string, CartographEdge>();
  for (const edge of readers) {
    const key = JSON.stringify([edge.from, edge.to, edge.kind, edge.label.trim().toLowerCase()]);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { id: `e${merged.size + 1}`, from: edge.from, to: edge.to, kind: edge.kind, label: edge.label, evidence: dedupeEvidence(edge.evidence) });
    } else {
      existing.evidence = dedupeEvidence([...existing.evidence, ...edge.evidence]);
    }
  }
  return [...merged.values()];
}

function dedupeEvidence(items: Evidence[]): Evidence[] {
  return [...new Map(items.map((item) => [JSON.stringify([item.path, item.line]), item])).values()];
}

/**
 * Applies the Cartographer's component merges (aliases) to the edges, drops
 * edges whose ends aren't components, and folds edges that became duplicates
 * into the first one. Returns the edges and where each dropped id went.
 */
export function remapEdges(
  edges: CartographEdge[], nodes: CartographNode[], aliases: { from: string; to: string }[],
): { edges: CartographEdge[]; redirect: Map<string, string> } {
  const alias = new Map(aliases.map((a) => [a.from, a.to]));
  const resolve = (id: string) => {
    for (let i = 0; i < 5 && alias.has(id); i++) id = alias.get(id)!;
    return id;
  };
  const nodeIds = new Set(nodes.map((node) => node.id));
  const byKey = new Map<string, CartographEdge>();
  const redirect = new Map<string, string>();
  for (const edge of edges) {
    const from = resolve(edge.from);
    const to = resolve(edge.to);
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) continue;
    const key = JSON.stringify([from, to, edge.kind, edge.label.trim().toLowerCase()]);
    const kept = byKey.get(key);
    if (kept) {
      kept.evidence = dedupeEvidence([...kept.evidence, ...edge.evidence]);
      redirect.set(edge.id, kept.id);
    } else {
      byKey.set(key, { ...edge, from, to });
    }
  }
  return { edges: [...byKey.values()], redirect };
}

export function cleanFlows(flows: CartographFlow[], edges: Pick<CartographEdge, "id">[]): CartographFlow[] {
  const ids = new Set(edges.map((edge) => edge.id));
  const seen = new Set<string>();
  return flows.flatMap((flow) => {
    if (seen.has(flow.id)) return [];
    const steps = flow.steps.filter((step) => ids.has(step.edge));
    if (!steps.length) return [];
    seen.add(flow.id);
    return [{ ...flow, steps }];
  });
}

export function compactGraph(graph: CartographGraph, includeFlows = false) {
  return {
    summary: graph.summary, stack: graph.stack,
    nodes: graph.nodes.map(({ id, kind, label, summary, files, tech, details }) => ({ id, kind, label, summary, files, tech, details })),
    edges: graph.edges.map(({ id, from, to, kind, label, evidence }) => ({
      id, from, to, kind, label, evidencePaths: [...new Set(evidence.map((item) => item.path))],
    })),
    flows: graph.flows.map(({ id, name, trigger, description, steps }) => ({
      id, name, trigger, description, steps: steps.map((step) => includeFlows ? step : { edge: step.edge }),
    })),
  };
}

/** Bound the entire changed-file payload, including diffs and numbering overhead.
 * Truncate content at line boundaries to preserve evidence coordinates. */
export function reviewFiles(changes: ChangedFile[], files: RepoFile[], tokenLimit = 40_000) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  let remaining = Math.max(0, tokenLimit * 4 - 2);
  const supplied = new Map<string, string>();
  const entries: Array<{ path: string; status: ChangedFile["status"]; previousPath?: string;
    patch: string; content: string | null; truncated: boolean }> = [];
  for (const change of changes) {
    const entry = { ...change, patch: "", content: null as string | null, truncated: false };
    const baseSize = JSON.stringify(entry).length + (entries.length ? 1 : 0);
    if (baseSize > remaining) break;
    remaining -= baseSize;
    const take = (value: string) => {
      // JSON escaping is part of the actual input budget.
      let low = 0, high = value.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (JSON.stringify(value.slice(0, mid)).length - 2 <= remaining) low = mid;
        else high = mid - 1;
      }
      const chunk = value.slice(0, low);
      remaining -= JSON.stringify(chunk).length - 2;
      return chunk;
    };
    entry.patch = take(change.patch);
    const file = change.status !== "deleted" ? byPath.get(change.path) : undefined;
    if (file) {
      const numbered = numberLines(file.content);
      // Replacing null with a JSON string frees two characters.
      remaining += 2;
      const chunk = take(numbered);
      const content = chunk.length === numbered.length ? chunk : chunk.slice(0, Math.max(0, chunk.lastIndexOf("\n")));
      entry.content = content;
      const count = content ? content.split("\n").length : 0;
      supplied.set(change.path, file.content.split("\n").slice(0, count).join("\n"));
      entry.truncated = content.length !== numbered.length;
    }
    entry.truncated ||= entry.patch !== change.patch || (!file && change.status !== "deleted");
    entries.push(entry);
  }
  return { entries, supplied, omitted: changes.length - entries.length };
}

/** Evidence must come from supplied (changed) content. Whitespace-insensitive; exact
 * line numbers are corrected later by the server's verifier. */
export function isSuppliedEvidence(evidence: Evidence, supplied: Map<string, string>): boolean {
  const content = supplied.get(evidence.path);
  const squash = (s: string) => s.replace(/\s+/g, " ").trim();
  const snippet = squash(evidence.snippet);
  if (content === undefined || snippet.length === 0) return false;
  const lines = content.split("\n");
  return Number.isInteger(evidence.line) && evidence.line > 0 && evidence.line <= lines.length
    && lines.some((line) => squash(line).includes(snippet));
}

/** Ordered results despite concurrent completion; at most limit tasks run at once. */
export async function concurrentMap<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Concurrency limit must be positive");
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  // Stop scheduling after a fatal failure, and drain in-flight work before rejecting.
  const workers = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }));
  for (const worker of workers) if (worker.status === "rejected") throw worker.reason;
  return results;
}
