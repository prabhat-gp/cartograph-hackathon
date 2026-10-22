// Tool implementations, shared by the MCP server (ChatGPT) and the REST API
// that powers the standalone UI and tests.
import { type CartographFlow, type CartographGraph, type DriftReport, shortSha } from "../shared/graph";
import { getBrain } from "./brain-select";
import {
  blastRadius,
  findNode,
  flowText,
  flowView,
  graphSummary,
  graphText,
  matchFlow,
  nodeMap,
} from "./graph/analysis";
import { remapFlows } from "./graph/verify";
import { codexRuntime } from "./brain/codex";
import { activeJob, activeJobs, getJob, startMapJob, startReviewJob } from "./jobs";
import { resolveRepo } from "./repo";
import { localRepoAllowed } from "./security";
import { findRepo, listDrift, listRepos, loadGraph, saveGraph } from "./store";

export interface ToolOutput {
  /** Text the model reads. */
  text: string;
  /** structuredContent: seen by the model and the UI. Keep it compact. */
  structured: Record<string, unknown>;
  /** _meta: seen by the UI only. Carries the full graph so the view renders without a round trip. */
  meta?: Record<string, unknown>;
}

const GRAPH_META = "cartograph/graph";
const REPORTS_META = "cartograph/reports";

export class ToolError extends Error {}

function requireGraph(repo: string | undefined): CartographGraph {
  const record = findRepo(repo);
  if (!record) {
    throw new ToolError(
      repo
        ? `"${repo}" hasn't been mapped yet. Call map_repo with its GitHub URL first.`
        : "No repository has been mapped yet. Call map_repo with a GitHub URL first.",
    );
  }
  const graph = loadGraph(record.repo.key);
  if (!graph) throw new ToolError(`${record.repo.name} is still being mapped. Try again when the map is ready.`);
  return graph;
}

function repoList() {
  const mapped = listRepos().map((r) => {
    const g = r.latestSha ? loadGraph(r.repo.key, r.latestSha) : undefined;
    return {
      key: r.repo.key,
      name: r.repo.name,
      source: r.repo.source,
      sha: r.latestSha ?? null,
      mappedAt: r.mappedAt ?? null,
      components: g?.nodes.length ?? 0,
      dependencies: g?.edges.length ?? 0,
      mapping: activeJob(r.repo.key)?.id ?? null,
    };
  });
  // First maps still running: not in the store yet, but the UI should show them.
  const known = new Set(mapped.map((r) => r.key));
  const pending = activeJobs()
    .filter((j) => j.kind === "map" && !known.has(j.repoKey))
    .map((j) => ({ key: j.repoKey, name: j.repoName, source: "github", sha: null, mappedAt: null, components: 0, dependencies: 0, mapping: j.id }));
  return [...pending, ...mapped];
}

// ---------------------------------------------------------------- model-facing

export async function cartographHome(args: { repo?: string }): Promise<ToolOutput> {
  const repos = repoList();
  const current = findRepo(args.repo);
  const graph = current ? loadGraph(current.repo.key) : undefined;
  return {
    text: repos.length
      ? `Cartograph is open. Mapped repos: ${repos.map((r) => `${r.name} (${r.components} components)`).join(", ")}.`
      : "Cartograph is open. No repository is mapped yet: ask the user for a GitHub repo and call map_repo.",
    structured: { view: graph ? "map" : "home", repoKey: current?.repo.key ?? null, repos, summary: graph ? graphSummary(graph) : null },
    ...(graph ? { meta: { [GRAPH_META]: graph } } : {}),
  };
}

export async function mapRepo(args: { repo: string; branch?: string; force?: boolean }): Promise<ToolOutput> {
  // Already mapped (e.g. "chai-commerce")? A remote caller gets the cached map of a
  // local repo, but can never make Cartograph re-read that folder.
  const known = findRepo(args.repo);
  if (known?.latestSha && known.repo.source === "local" && !localRepoAllowed(known.repo.location)) {
    const graph = loadGraph(known.repo.key)!;
    return {
      text: `${graph.repo.name} is mapped. ${graphText(graph)}`,
      structured: { view: "map", repoKey: graph.repo.key, status: "done", summary: graphSummary(graph) },
      meta: { [GRAPH_META]: graph },
    };
  }

  let job;
  try {
    const ref = known ? known.repo : resolveRepo(args.repo);
    if (ref.source === "local" && !localRepoAllowed(ref.location)) {
      throw new ToolError("Cartograph maps GitHub repositories. Give it a link like github.com/owner/repo.");
    }
    job = startMapJob(known ? known.repo.location : args.repo, { branch: args.branch, force: args.force });
  } catch (err) {
    if (err instanceof ToolError) throw err;
    throw new ToolError((err as Error).message);
  }
  // A cached map resolves almost instantly; give it a moment.
  for (let i = 0; i < 15 && job.status === "running"; i++) await new Promise((r) => setTimeout(r, 100));

  if (job.status === "error") throw new ToolError(job.error ?? "Mapping failed");
  if (job.status === "done") {
    const graph = loadGraph(job.repoKey)!;
    return {
      text: `${graph.repo.name} is mapped${job.cached ? " (cached)" : ""}. ${graphText(graph)}\n\nThe Cartograph view shows the interactive map. Offer to trace a flow (trace_flow) or show what breaks if a component fails (blast_radius).`,
      structured: { view: "map", repoKey: job.repoKey, jobId: job.id, status: "done", summary: graphSummary(graph) },
      meta: { [GRAPH_META]: graph },
    };
  }
  return {
    text:
      `Mapping ${job.repoName} has started. Cartograph agents are reading the code: a Scout plans the work, Readers analyse ` +
      `modules in parallel, a Cartographer assembles the map, and a Verifier drops any dependency it can't find in the ` +
      `code. The Cartograph view shows live progress; it takes ${codexRuntime() ? "a few minutes" : "about a minute"}. Don't call map_repo again for this repo.`,
    structured: { view: "map", repoKey: job.repoKey, jobId: job.id, status: "running", summary: null },
  };
}

export async function traceFlow(args: { repo?: string; question: string }): Promise<ToolOutput> {
  const graph = requireGraph(args.repo);
  let flow: CartographFlow | undefined = matchFlow(graph, args.question);
  let answer = "";

  if (!flow) {
    try {
      const result = await (await getBrain()).traceQuestion({ graph, question: args.question });
      answer = result.answer;
      if (result.flowId) flow = graph.flows.find((f) => f.id === result.flowId);
      if (!flow && result.flow) {
        const [clean] = remapFlows([result.flow], new Map(), new Set(graph.edges.map((e) => e.id)));
        if (clean) {
          flow = clean.id && graph.flows.some((f) => f.id === clean.id) ? { ...clean, id: `${clean.id}-q` } : clean;
          // Remember it, so the same question is instant next time.
          await saveGraph({ ...graph, flows: [...graph.flows, flow] });
        }
      }
    } catch (err) {
      console.error("tracer failed", err);
    }
  }
  if (!flow) {
    throw new ToolError(
      answer ||
        `Cartograph couldn't find that path in ${graph.repo.name}. Known flows: ${graph.flows.map((f) => f.name).join("; ")}.`,
    );
  }

  const view = flowView(graph, flow);
  return {
    text: `${flowText(view)}${answer ? `\n\n${answer}` : ""}\n\nThe Cartograph view is animating this request hop by hop with the code behind each step.`,
    structured: { view: "trace", repoKey: graph.repo.key, sha: graph.sha, flow: view },
    meta: { [GRAPH_META]: graph },
  };
}

export async function blast(args: { repo?: string; component: string }): Promise<ToolOutput> {
  const graph = requireGraph(args.repo);
  const node = findNode(graph, args.component);
  if (!node) {
    throw new ToolError(`No component matching "${args.component}". Components: ${graph.nodes.map((n) => n.label).join(", ")}.`);
  }
  const b = blastRadius(graph, node.id)!;
  return {
    text: [
      b.summary,
      ...b.impacted.map((i) => `- ${i.node.label} (${i.node.kind}, ${i.depth === 1 ? "direct" : `${i.depth} hops away`})`),
      b.brokenFlows.length ? `Broken flows: ${b.brokenFlows.map((f) => f.name).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    structured: {
      view: "blast",
      repoKey: graph.repo.key,
      sha: graph.sha,
      nodeId: node.id,
      impacted: b.impacted.map((i) => ({ id: i.node.id, label: i.node.label, kind: i.node.kind, depth: i.depth })),
      brokenFlows: b.brokenFlows.map((f) => ({ id: f.id, name: f.name })),
      summary: b.summary,
    },
    meta: { [GRAPH_META]: graph },
  };
}

export async function explainComponent(args: { repo?: string; component: string }): Promise<ToolOutput> {
  const graph = requireGraph(args.repo);
  const node = findNode(graph, args.component);
  if (!node) throw new ToolError(`No component matching "${args.component}".`);
  const nodes = nodeMap(graph);
  const fmt = (id: string) => nodes.get(id)?.label ?? id;
  const outgoing = graph.edges.filter((e) => e.from === node.id);
  const incoming = graph.edges.filter((e) => e.to === node.id);
  const cite = (e: (typeof graph.edges)[number]) => e.evidence.map((ev) => `${ev.path}:${ev.line} \`${ev.snippet}\``).join("; ");
  return {
    text: [
      `${node.label} (${node.kind}${node.tech ? `, ${node.tech}` : ""}): ${node.summary}`,
      node.details.length ? `Details: ${node.details.join("; ")}` : "",
      node.files.length ? `Files: ${node.files.map((f) => f.path).join(", ")}` : "",
      outgoing.length ? `Depends on:\n${outgoing.map((e) => `- ${fmt(e.to)} [${e.kind}: ${e.label}] (${cite(e)})`).join("\n")}` : "",
      incoming.length ? `Used by:\n${incoming.map((e) => `- ${fmt(e.from)} [${e.kind}: ${e.label}] (${cite(e)})`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    structured: {
      repoKey: graph.repo.key,
      node,
      dependsOn: outgoing.map((e) => ({ id: e.to, label: fmt(e.to), kind: e.kind, label2: e.label })),
      usedBy: incoming.map((e) => ({ id: e.from, label: fmt(e.from), kind: e.kind, label2: e.label })),
    },
  };
}

function compactReport(r: DriftReport) {
  return {
    id: r.id,
    at: r.at,
    fromSha: r.fromSha,
    toSha: r.toSha,
    commit: r.commits[0]?.message ?? "",
    author: r.commits[0]?.author ?? "",
    summary: r.summary,
    maxSeverity: r.maxSeverity,
    findings: r.findings.map((f) => ({ severity: f.severity, title: f.title, detail: f.detail })),
    added: { components: r.added.nodes.length, dependencies: r.added.edges.length },
    removed: { components: r.removed.nodes.length, dependencies: r.removed.edges.length },
  };
}

export async function architectureDrift(args: { repo?: string; reportId?: string; limit?: number }): Promise<ToolOutput> {
  const graph = requireGraph(args.repo);
  const reports = listDrift(graph.repo.key);
  const selected = (args.reportId && reports.find((r) => r.id === args.reportId)) || reports[0];
  const recent = reports.slice(0, Math.min(args.limit ?? 5, 20));
  if (!selected) {
    return {
      text: `No pushes reviewed yet for ${graph.repo.name}. Cartograph reviews every push automatically once the GitHub webhook is set up.`,
      structured: { view: "drift", repoKey: graph.repo.key, reportId: null, reports: [] },
    };
  }
  const lines = [
    `Push ${shortSha(selected.fromSha)} → ${shortSha(selected.toSha)}${selected.commits[0] ? ` ("${selected.commits[0].message}")` : ""}: ${selected.summary}`,
    ...selected.findings.map((f) => `- [${f.severity}] ${f.title}: ${f.detail}`),
  ];
  return {
    text: `${lines.join("\n")}\n\nThe Cartograph view highlights the change on the map.`,
    structured: { view: "drift", repoKey: graph.repo.key, reportId: selected.id, reports: recent.map(compactReport) },
    meta: { [GRAPH_META]: graph, [REPORTS_META]: recent },
  };
}

export async function checkDrift(args: { repo?: string }): Promise<ToolOutput> {
  const graph = requireGraph(args.repo);
  const job = startReviewJob(graph.repo.key, { source: "manual" });
  if (!job) throw new ToolError("This repo needs a full map first.");
  return {
    text: `Cartograph is reviewing new commits on ${graph.repo.name} since ${shortSha(graph.sha)}. Results appear in the Cartograph view in a few seconds.`,
    structured: { view: "drift", repoKey: graph.repo.key, jobId: job.id, reportId: null, reports: [] },
  };
}

// ---------------------------------------------------------------- app-only

export async function appGraph(args: { repo?: string; sha?: string }) {
  const record = findRepo(args.repo);
  const graph = record ? loadGraph(record.repo.key, args.sha) : undefined;
  return { graph: graph ?? null, mapping: record ? (activeJob(record.repo.key)?.id ?? null) : null };
}

export async function appJob(args: { jobId: string }) {
  const job = getJob(args.jobId);
  if (!job) return { job: null };
  return { job: { ...job, log: job.log.slice(-60) } };
}

export async function appChanges(args: { repo?: string; after?: string }) {
  const record = findRepo(args.repo);
  if (!record) return { reports: [], latestSha: null, reviewing: null };
  const all = listDrift(record.repo.key);
  const idx = args.after ? all.findIndex((r) => r.id === args.after) : -1;
  const fresh = args.after ? (idx === -1 ? all.slice(0, 1) : all.slice(0, idx)) : all.slice(0, 10);
  const job = activeJob(record.repo.key);
  return {
    reports: fresh,
    latestSha: record.latestSha ?? null,
    reviewing: job && job.kind === "review" ? { id: job.id, log: job.log.slice(-8) } : null,
  };
}

export async function appRepos() {
  return { repos: repoList() };
}

export const toolImpls = {
  cartograph: cartographHome,
  map_repo: mapRepo,
  trace_flow: traceFlow,
  blast_radius: blast,
  explain_component: explainComponent,
  architecture_drift: architectureDrift,
  check_drift: checkDrift,
} as const;

export const appToolImpls = {
  cartograph_graph: appGraph,
  cartograph_job: appJob,
  cartograph_changes: appChanges,
  cartograph_repos: appRepos,
} as const;
