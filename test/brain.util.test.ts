import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { CartographGraph, CartographNode } from "../src/shared/graph";
import type { RepoFile, RepoSnapshot } from "../src/server/repo";
import {
  budgetGroups, cleanFlows, compactGraph, concurrentMap, fallbackGroups,
  isSuppliedEvidence, mergeComponents, mergeReaderEdges, numberReaderEdges, remapEdges,
  renderFiles, reviewFiles, scoutInput, toNode,
} from "../src/server/brain/util";
import {
  CartographerSchema, ReaderSchema, ReviewerSchema, ScoutSchema, TracerSchema,
  type ReaderOutput,
} from "../src/server/brain/schemas";

function file(path: string, tokens = 2, content = "first\n  second"): RepoFile {
  return { path, tokens, content, lines: content.split("\n").length };
}
const node: CartographNode = { id: "api", kind: "api", label: "API", summary: "Handles requests", files: [], details: [] };
const evidence = { path: "api/main.ts", line: 2, snippet: "  second" };
const dependency = { from: "api", to: "db", kind: "sql" as const, label: "SELECT orders", evidence: [evidence] };
const flow = { id: "orders", name: "Orders", trigger: "GET /orders", description: "Reads orders",
  steps: [{ edge: "e1", note: "Fetch orders." }, { edge: "missing", note: "Unknown." }] };
const snapshot: RepoSnapshot = {
  repo: { key: "example", name: "example", source: "local", location: "/example" },
  sha: "abc", tree: [], files: [], totalTokens: 0,
};
const graph: CartographGraph = {
  version: 1, repo: snapshot.repo, sha: "abc", generatedAt: "now", mode: "full",
  stack: [], summary: "System", nodes: [node], edges: [{ id: "e1", ...dependency }], flows: [flow],
  stats: { files: 1, tokens: 2, edgesProposed: 1, edgesVerified: 1, edgesDropped: 0,
    nodesDropped: 0, model: "test", durationMs: 0, agents: [] },
};

describe("reader planning", () => {
  it("falls back by top-level directory and covers every file with at most six groups", () => {
    const files = [file("main.ts"), ...Array.from({ length: 8 }, (_, i) => file(`dir${i}/index.ts`))];
    const groups = fallbackGroups(files);
    expect(groups).toHaveLength(6);
    expect(groups.flatMap((group) => group.files).sort()).toEqual(files.map((file) => file.path).sort());
    expect(fallbackGroups([])).toEqual([]);
  });
  it("repairs missing, duplicate and unknown assignments", () => {
    const files = [file("a/a.ts"), file("b/b.ts"), file("b/c.ts")];
    const { groups, skipped } = budgetGroups([
      { name: "a", focus: "API", files: ["a/a.ts", "a/a.ts", "missing"] },
      { name: "b", focus: "DB", files: ["a/a.ts", "b/b.ts"] },
    ], files);
    expect(skipped).toBe(0);
    expect(groups.flatMap((group) => group.files).sort()).toEqual(files.map((file) => file.path).sort());
  });
  it("prioritizes runtime files and enforces per-group and total token budgets", () => {
    const files = [file("docs/large.ts", 60), file("src/routes/orders.ts", 60), file("src/workers/order.ts", 40), file("huge.ts", 101)];
    const { groups, skipped } = budgetGroups([], files, 100, 60);
    expect(skipped).toBe(2);
    expect(groups.flatMap((group) => group.files).sort()).toEqual(["src/routes/orders.ts", "src/workers/order.ts"]);
    for (const group of groups) {
      expect(group.files.reduce((sum, path) => sum + files.find((file) => file.path === path)!.tokens, 0)).toBeLessThanOrEqual(60);
    }
  });
  it("splits oversized groups, never schedules over fourteen readers, and reports omissions", () => {
    const files = Array.from({ length: 20 }, (_, i) => file(`src/service${i}.ts`, 20_000));
    const result = budgetGroups([{ name: "src", focus: "Services", files: files.map((file) => file.path) }], files);
    expect(result.groups.length).toBe(14);
    expect(result.groups.flatMap((group) => group.files)).toHaveLength(14);
    expect(result.skipped).toBe(6);
  });
  it("assigns every file under a folder the Scout names, deepest folder first", () => {
    const files = [file("src/api/orders.ts"), file("src/api/admin/users.ts"), file("src/db.ts"), file("web/app.tsx")];
    const result = budgetGroups([
      { name: "api", focus: "API", files: ["src/api/"] },
      { name: "admin", focus: "Admin", files: ["src/api/admin"] },
      { name: "data", focus: "Data", files: ["src/db.ts"] },
    ], files);
    const groupOf = (path: string) => result.groups.find((g) => g.files.includes(path))?.name;
    expect(groupOf("src/api/orders.ts")).toBe("api");
    expect(groupOf("src/api/admin/users.ts")).toBe("admin");
    expect(groupOf("src/db.ts")).toBe("data");
    expect(groupOf("web/app.tsx")).toBeDefined();
  });
  it("renders original line numbers and whitespace", () => {
    expect(renderFiles([file("a.ts")])).toBe("=== a.ts ===\n1| first\n2|   second");
  });
  it("caps the scout tree and README without truncating manifests", () => {
    const readme = Array.from({ length: 150 }, (_, i) => `line ${i}`).join("\n");
    const input = JSON.parse(scoutInput({ ...snapshot,
      tree: Array.from({ length: 2600 }, (_, i) => `${i}.ts`),
      files: [file("README.md", 100, readme), file("apps/web/package.json", 4, '{"dependencies":{}}'), file("main.ts")],
    }));
    expect(input.tree).toHaveLength(2500);
    expect(input.omittedPaths).toBe(100);
    expect(input.manifests[0].content.split("\n")).toHaveLength(120);
    expect(input.manifests[1].content).toBe('{"dependencies":{}}');
    expect(input.files).toHaveLength(3);
  });
});

describe("graph assembly", () => {
  it("numbers all reader edges globally, including across empty readers", () => {
    const output: ReaderOutput = { edges: [dependency], newComponents: [], componentNotes: [] };
    expect(numberReaderEdges([output, { ...output, edges: [] }, output]).map((edge) => edge.id)).toEqual(["r1", "r2"]);
  });
  it("merges reader edges in code, unioning their evidence by path and line", () => {
    const readers = numberReaderEdges([
      { edges: [dependency, { ...dependency, label: "select orders ", evidence: [evidence, { ...evidence, line: 3, snippet: "third" }] }], newComponents: [], componentNotes: [] },
      { edges: [{ ...dependency, label: "INSERT INTO orders" }], newComponents: [], componentNotes: [] },
    ]);
    const edges = mergeReaderEdges(readers);
    expect(edges.map((e) => [e.id, e.label])).toEqual([["e1", "SELECT orders"], ["e2", "INSERT INTO orders"]]);
    expect(edges[0].evidence).toEqual([evidence, { ...evidence, line: 3, snippet: "third" }]);
  });
  it("follows component merges, drops edges to unknown components and folds new duplicates", () => {
    const edges = [
      { id: "e1", ...dependency },
      { id: "e2", ...dependency, from: "orders-api", evidence: [{ ...evidence, line: 9 }] },
      { id: "e3", ...dependency, to: "missing" },
    ];
    const { edges: out, redirect } = remapEdges(edges, [node, { ...node, id: "db" }], [{ from: "orders-api", to: "api" }]);
    expect(out.map((e) => e.id)).toEqual(["e1"]);
    expect(out[0].evidence.map((e) => e.line)).toEqual([2, 9]);
    expect(redirect.get("e2")).toBe("e1");
  });
  it("prunes missing flow steps, empty flows and duplicate flow ids", () => {
    expect(cleanFlows([flow, flow, { ...flow, id: "empty", steps: [{ edge: "missing", note: "Gone" }] }], graph.edges))
      .toEqual([{ ...flow, steps: [flow.steps[0]] }]);
  });
  it("converts nullable node fields to the shared contract", () => {
    expect(toNode({ ...node, tech: null, files: [{ path: "a.ts", line: null }, { path: "b.ts", line: 2 }] }))
      .toEqual({ ...node, tech: undefined, files: [{ path: "a.ts" }, { path: "b.ts", line: 2 }] });
  });
  it("merges duplicate component paths without losing known technology", () => {
    const component = { id: "api", kind: "api" as const, label: "API", summary: "API", tech: null, paths: ["src/api"] };
    expect(mergeComponents([component, { ...component, tech: "Express", paths: ["src/api", "routes"] }]))
      .toEqual([{ ...component, tech: "Express", paths: ["src/api", "routes"] }]);
  });
  it("compacts graph evidence and omits reviewer flow notes", () => {
    const compact = compactGraph(graph);
    expect(compact.edges[0].evidencePaths).toEqual(["api/main.ts"]);
    expect(compact.edges[0]).not.toHaveProperty("evidence");
    expect(compact.flows[0].steps[0]).toEqual({ edge: "e1" });
    expect(compactGraph(graph, true).flows[0].steps[0]).toEqual(flow.steps[0]);
  });
});

describe("review payload and evidence", () => {
  it("includes new content for modifications and renames, never deletions", () => {
    const result = reviewFiles([
      { path: "api/main.ts", status: "modified", patch: "+second" },
      { path: "renamed.ts", previousPath: "old.ts", status: "renamed", patch: "rename" },
      { path: "gone.ts", status: "deleted", patch: "-first" },
    ], [file("api/main.ts"), file("renamed.ts"), file("gone.ts")]);
    expect(result.entries[0].content).toBe("1| first\n2|   second");
    expect(result.entries[1].previousPath).toBe("old.ts");
    expect(result.entries[2].content).toBeNull();
    expect(result.supplied.has("gone.ts")).toBe(false);
    expect(isSuppliedEvidence(evidence, result.supplied)).toBe(true);
    // Whitespace-insensitive (the server's verifier fixes exact lines later)…
    expect(isSuppliedEvidence({ ...evidence, snippet: "second" }, result.supplied)).toBe(true);
    // …but the snippet must exist in the supplied content.
    expect(isSuppliedEvidence({ ...evidence, snippet: "third" }, result.supplied)).toBe(false);
    expect(isSuppliedEvidence({ ...evidence, line: 10 }, result.supplied)).toBe(false);
    expect(isSuppliedEvidence({ ...evidence, path: "gone.ts" }, result.supplied)).toBe(false);
  });
  it("bounds escaped payload size and retains only complete numbered lines", () => {
    const content = Array.from({ length: 300 }, (_, i) => `call("${i}", "\\path");`).join("\n");
    const result = reviewFiles([{ path: "a.ts", status: "added", patch: "new file" }], [file("a.ts", 3000, content)], 200);
    expect(JSON.stringify(result.entries).length).toBeLessThanOrEqual(800);
    expect(result.entries[0].truncated).toBe(true);
    const count = result.supplied.get("a.ts")!.split("\n").length;
    const numbered = renderFiles([file("a.ts", 1, content)]).split("\n").slice(1);
    expect(result.entries[0].content).toBe(numbered.slice(0, count).join("\n"));
    expect(isSuppliedEvidence({ path: "a.ts", line: 300, snippet: content.split("\n")[299] }, result.supplied)).toBe(false);
  });
  it("handles no budget and missing snapshot content explicitly", () => {
    expect(reviewFiles([{ path: "a", status: "added", patch: "" }], [], 0).omitted).toBe(1);
    expect(reviewFiles([{ path: "a", status: "added", patch: "" }], []).entries[0].truncated).toBe(true);
  });
});

it("limits reader concurrency while preserving input order", async () => {
  let active = 0, peak = 0;
  const result = await concurrentMap([1, 2, 3, 4, 5, 6], 4, async (value) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 7 - value));
    active--;
    return value * 2;
  });
  expect(peak).toBe(4);
  expect(result).toEqual([2, 4, 6, 8, 10, 12]);
  await expect(concurrentMap([], 0, async () => 0)).rejects.toThrow();
});

it("accepts agent answers that leave out lists that may be empty", () => {
  expect(ReaderSchema.parse({ edges: [] })).toEqual({ edges: [], newComponents: [], componentNotes: [] });
  expect(ReviewerSchema.parse({ summary: "No change" })).toMatchObject({ addNodes: [], addEdges: [], removeEdgeIds: [], findings: [] });
  // A dependency without evidence is still rejected: no citation, no arrow.
  expect(() => ReaderSchema.parse({ edges: [{ from: "a", to: "b", kind: "http", label: "GET /", evidence: [] }] })).toThrow();
  for (const schema of [ScoutSchema, ReaderSchema, CartographerSchema, ReviewerSchema, TracerSchema]) {
    expect(z.toJSONSchema(schema).type).toBe("object");
  }
});

it("drains in-flight readers and stops scheduling after a fatal failure", async () => {
  const started: number[] = [];
  let finished = false;
  await expect(concurrentMap([1, 2, 3, 4], 2, async (value) => {
    started.push(value);
    if (value === 1) throw new Error("aborted");
    await new Promise((resolve) => setTimeout(resolve, 5));
    finished = true;
    return value;
  })).rejects.toThrow("aborted");
  expect(started).toEqual([1, 2]);
  expect(finished).toBe(true);
});
