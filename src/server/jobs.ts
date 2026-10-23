// Job runner: full maps and incremental push reviews, one at a time per repo,
// with live progress the UI can poll.
import { randomUUID } from "node:crypto";
import {
  type CartographEdge,
  type CartographGraph,
  type CartographNode,
  type DriftFinding,
  type DriftReport,
  type RepoRef,
  edgeKey,
  shortSha,
} from "../shared/graph";
import { getBrain } from "./brain-select";
import { runtimeLabel } from "../config";
import type { ProgressEvent } from "./brain/types";
import { diffGraphs, isEmptyDiff, maxSeverity, ruleFindings } from "./graph/analysis";
import { FileIndex, cleanNodes, remapFlows, reverifyEdges, verifyDraft, verifyEdges } from "./graph/verify";
import { diffCommits, listCommits, resolveRepo, snapshotRepo, syncRepo } from "./repo";
import { takeMapBudget } from "./security";
import { appendDrift, getRepo, loadGraph, saveGraph, upsertRepo } from "./store";

export type JobKind = "map" | "review";
export type JobStatus = "running" | "done" | "error";

export interface JobLogEntry extends ProgressEvent {
  at: string;
}

export interface Job {
  id: string;
  kind: JobKind;
  repoKey: string;
  repoName: string;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  sha?: string;
  cached?: boolean;
  error?: string;
  log: JobLogEntry[];
  /** For review jobs: the drift report produced. */
  reportId?: string;
}

const jobs = new Map<string, Job>();
const running = new Map<string, Job>(); // repoKey → active job
const lanes = new Map<string, Promise<unknown>>(); // repoKey → serialized work

type DriftListener = (report: DriftReport) => void;
const driftListeners: DriftListener[] = [];
export function onDrift(listener: DriftListener): void {
  driftListeners.push(listener);
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function activeJob(repoKey: string): Job | undefined {
  return running.get(repoKey);
}

export function activeJobs(): Job[] {
  return [...running.values()];
}

/** What produced the map, as shown in the UI. Never let fixture data pose as agent output. */
function producedBy(): string {
  if (process.env.CARTOGRAPH_BRAIN === "fixture") return "fixture (offline dev data)";
  return runtimeLabel();
}

function newJob(kind: JobKind, repo: RepoRef): Job {
  const job: Job = {
    id: `job_${randomUUID().slice(0, 8)}`,
    kind,
    repoKey: repo.key,
    repoName: repo.name,
    status: "running",
    startedAt: new Date().toISOString(),
    log: [],
  };
  jobs.set(job.id, job);
  return job;
}

function logger(job: Job) {
  return (e: ProgressEvent) => {
    job.log.push({ ...e, at: new Date().toISOString() });
    if (job.log.length > 400) job.log.splice(0, job.log.length - 400);
    if (process.env.CARTOGRAPH_DEBUG) console.log(`[${job.id}] ${e.agent}/${e.phase}: ${e.message}`);
  };
}

/** Run `fn` after any earlier work for the same repo finishes. */
function inLane<T>(repoKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = lanes.get(repoKey) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  lanes.set(repoKey, next.catch(() => undefined));
  return next;
}

function finish(job: Job, status: JobStatus, error?: unknown) {
  job.status = status;
  job.finishedAt = new Date().toISOString();
  if (error) {
    job.error = error instanceof Error ? error.message : String(error);
    logger(job)({ agent: "pipeline", phase: "error", message: job.error });
    console.error(`[${job.id}] failed:`, error);
  }
  if (running.get(job.repoKey) === job) running.delete(job.repoKey);
}

// ---------------------------------------------------------------- full map

export interface StartMapOptions {
  branch?: string;
  /** Re-map even if this commit was already mapped. */
  force?: boolean;
}

/** Start (or join) a full map of `input`. Returns immediately with the job. */
export function startMapJob(input: string, opts: StartMapOptions = {}): Job {
  const repo = resolveRepo(input);
  const existing = running.get(repo.key);
  if (existing) return existing;

  const job = newJob("map", repo);
  running.set(repo.key, job);
  const log = logger(job);

  void inLane(repo.key, async () => {
    try {
      const started = Date.now();
      log({ agent: "pipeline", phase: "start", message: `Fetching ${repo.name}…` });
      const { dir, sha, branch } = await syncRepo(repo, { branch: opts.branch ?? getRepo(repo.key)?.branch });
      job.sha = sha;

      if (!opts.force && loadGraph(repo.key, sha)) {
        log({ agent: "pipeline", phase: "done", message: `Already mapped at ${shortSha(sha)}, loaded from cache` });
        await upsertRepo(repo.key, { repo, branch, latestSha: sha, mappedAt: new Date().toISOString() });
        job.cached = true;
        return finish(job, "done");
      }

      if (!takeMapBudget()) throw new Error("Cartograph's daily mapping limit is reached (CARTOGRAPH_MAX_MAPS_PER_DAY). Cached maps still work.");
      const snapshot = await snapshotRepo(repo, dir, sha, branch);
      if (snapshot.files.length > 8000) throw new Error(`${repo.name} is too large for Cartograph (${snapshot.files.length} source files).`);
      log({
        agent: "pipeline",
        phase: "progress",
        message: `Read ${snapshot.files.length} source files at ${shortSha(sha)} (~${Math.round(snapshot.totalTokens / 1000)}k tokens)`,
        data: { files: snapshot.files.length, tokens: snapshot.totalTokens },
      });

      const draft = await (await getBrain()).mapRepository(snapshot, { onProgress: log });

      log({ agent: "pipeline", phase: "start", message: `Verifier · checking ${draft.edges.length} cited dependencies against the code…` });
      const { graph, dropped } = verifyDraft(draft, snapshot, {
        repo,
        sha,
        branch,
        model: producedBy(),
        durationMs: Date.now() - started,
      });
      log({
        agent: "pipeline",
        phase: "done",
        message: `Verifier · ${graph.edges.length} dependencies verified, ${dropped.length} dropped (evidence not found in code)`,
        data: { verified: graph.edges.length, dropped: dropped.length },
      });

      await saveGraph(graph);
      await upsertRepo(repo.key, { repo, branch, latestSha: sha, reviewedSha: sha, mappedAt: graph.generatedAt });
      log({ agent: "pipeline", phase: "done", message: `Mapped ${graph.nodes.length} components, ${graph.edges.length} dependencies, ${graph.flows.length} flows` });
      finish(job, "done");
    } catch (err) {
      finish(job, "error", err);
    }
  });

  return job;
}

// ---------------------------------------------------------------- push review

export interface StartReviewOptions {
  /** Commit to review up to; defaults to the branch tip. */
  toSha?: string;
  source: "github" | "local" | "manual";
}

/**
 * Review what changed since the last mapped commit and patch the graph
 * incrementally. Returns undefined if the repo was never mapped.
 */
export function startReviewJob(repoKey: string, opts: StartReviewOptions): Job | undefined {
  const record = getRepo(repoKey);
  if (!record?.latestSha) return undefined;
  const repo = record.repo;
  const job = newJob("review", repo);
  const log = logger(job);

  void inLane(repoKey, async () => {
    running.set(repoKey, job);
    try {
      const current = getRepo(repoKey)!;
      const before = loadGraph(repoKey, current.latestSha);
      if (!before) throw new Error("No previous map to compare against");

      const { dir, sha: toSha, branch } = await syncRepo(repo, { branch: current.branch, sha: opts.toSha });
      job.sha = toSha;
      if (toSha === before.sha) {
        log({ agent: "pipeline", phase: "done", message: `Already up to date at ${shortSha(toSha)}` });
        return finish(job, "done");
      }

      log({ agent: "pipeline", phase: "start", message: `Reviewing ${shortSha(before.sha)} → ${shortSha(toSha)}` });
      const [changes, commits] = await Promise.all([diffCommits(dir, before.sha, toSha), listCommits(dir, before.sha, toSha)]);
      const snapshot = await snapshotRepo(repo, dir, toSha, branch);
      const index = new FileIndex(snapshot);
      const changedPaths = new Set(changes.flatMap((c) => [c.path, ...(c.previousPath ? [c.previousPath] : [])]));
      log({ agent: "pipeline", phase: "progress", message: `${changes.length} source file${changes.length === 1 ? "" : "s"} changed in ${commits.length} commit${commits.length === 1 ? "" : "s"}` });

      // 1. Deterministic: re-verify edges whose evidence lives in changed files.
      const { kept, lost } = reverifyEdges(before.edges, changedPaths, index);
      if (lost.length) log({ agent: "pipeline", phase: "progress", message: `Verifier · ${lost.length} dependenc${lost.length === 1 ? "y" : "ies"} no longer in the code` });

      // 2. Agent: what did the change add?
      const review = changes.length
        ? await (await getBrain()).reviewChanges({ graph: before, snapshot, changes }, { onProgress: log })
        : { addNodes: [], addEdges: [], removeEdgeIds: [], findings: [], summary: "No source files changed.", agentStats: [] };

      // Reviewer removals only count for edges the change actually touched.
      const touchable = new Set(before.edges.filter((e) => e.evidence.some((ev) => changedPaths.has(ev.path))).map((e) => e.id));
      const reviewerRemoved = new Set(review.removeEdgeIds.filter((id) => touchable.has(id)));
      const keptEdges = kept.filter((e) => !reviewerRemoved.has(e.id));

      // Nodes: drop code components whose files are all gone; add new ones.
      const deleted = new Set(changes.filter((c) => c.status === "deleted").map((c) => c.path));
      let nodes: CartographNode[] = before.nodes.filter((n) => n.files.length === 0 || n.files.some((f) => !deleted.has(f.path) && index.exists(f.path)));
      const known = new Set(nodes.map((n) => n.id));
      const added = cleanNodes(review.addNodes, index).filter((n) => !known.has(n.id));
      nodes = [...nodes, ...added];
      const nodeIds = new Set(nodes.map((n) => n.id));

      const verifiedNew = verifyEdges(review.addEdges, nodeIds, index);
      const keptKeys = new Set(keptEdges.map(edgeKey));
      const newEdges = verifiedNew.edges.filter((e) => !keptKeys.has(edgeKey(e)));
      const edges: CartographEdge[] = [...keptEdges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to)), ...newEdges];
      log({
        agent: "pipeline",
        phase: "done",
        message: `Verifier · ${newEdges.length} new dependenc${newEdges.length === 1 ? "y" : "ies"} verified, ${verifiedNew.dropped.length} dropped`,
      });

      // Unreferenced data/external nodes that lost their last edge go too.
      const touched = new Set(edges.flatMap((e) => [e.from, e.to]));
      nodes = nodes.filter((n) => n.files.length > 0 || touched.has(n.id));

      const after: CartographGraph = {
        ...before,
        sha: toSha,
        branch: branch ?? before.branch,
        generatedAt: new Date().toISOString(),
        mode: "incremental",
        nodes,
        edges,
        flows: remapFlows(before.flows, new Map(), new Set(edges.map((e) => e.id))),
        stats: {
          ...before.stats,
          edgesProposed: before.stats.edgesProposed + review.addEdges.length,
          edgesVerified: edges.length,
          edgesDropped: before.stats.edgesDropped + verifiedNew.dropped.length,
          agents: review.agentStats,
        },
      };

      // 3. What changed, and does it matter?
      const diff = diffGraphs(before, after);
      const idMap = verifiedNew.idMap;
      const findings: DriftFinding[] = [
        ...ruleFindings(before, after, diff).map((f, i) => ({ ...f, id: `rule-${i + 1}` })),
        ...review.findings.map((f, i) => ({
          ...f,
          id: `review-${i + 1}`,
          rule: "reviewer",
          source: "reviewer" as const,
          edgeIds: f.edgeIds.map((id) => idMap.get(id) ?? id).filter((id) => edges.some((e) => e.id === id) || before.edges.some((e) => e.id === id)),
          nodeIds: f.nodeIds.filter((id) => nodeIds.has(id) || before.nodes.some((n) => n.id === id)),
        })),
      ];
      const brokenFlows = before.flows
        .filter((f) => f.steps.some((s) => diff.removedEdges.some((e) => e.id === s.edge)))
        .map((f) => f.name);

      const report: DriftReport = {
        id: `drift_${Date.now().toString(36)}`,
        repoKey,
        repoName: repo.name,
        fromSha: before.sha,
        toSha,
        at: new Date().toISOString(),
        commits,
        changedFiles: changes.map((c) => c.path),
        added: { nodes: diff.addedNodes, edges: diff.addedEdges },
        removed: { nodes: diff.removedNodes, edges: diff.removedEdges },
        brokenFlows,
        findings: dedupeFindings(findings),
        summary: isEmptyDiff(diff) && findings.length === 0 ? "No architectural change." : review.summary || summarizeDiff(diff),
        maxSeverity: maxSeverity(findings),
      };

      await saveGraph(after);
      await upsertRepo(repoKey, { repo, branch: after.branch, latestSha: toSha, reviewedSha: toSha, mappedAt: after.generatedAt });
      await appendDrift(report);
      job.reportId = report.id;
      log({
        agent: "pipeline",
        phase: "done",
        message:
          report.maxSeverity === "none"
            ? `No architectural drift in ${shortSha(toSha)}`
            : `Drift in ${shortSha(toSha)}: ${report.findings.length} finding${report.findings.length === 1 ? "" : "s"} (max: ${report.maxSeverity})`,
      });
      finish(job, "done");
      for (const l of driftListeners) {
        try {
          l(report);
        } catch (err) {
          console.error("drift listener failed", err);
        }
      }
    } catch (err) {
      finish(job, "error", err);
    }
  });

  return job;
}

/** Rule and reviewer findings often describe the same thing; keep the rule's. */
function dedupeFindings(findings: DriftFinding[]): DriftFinding[] {
  const out: DriftFinding[] = [];
  for (const f of findings) {
    const dup = out.find((o) => o.edgeIds.length > 0 && f.edgeIds.length > 0 && o.edgeIds.some((id) => f.edgeIds.includes(id)) && o.source !== f.source);
    if (dup) {
      // Keep the rule's deterministic title, but the reviewer's specific explanation.
      if (dup.source === "rule" && f.source === "reviewer" && f.detail.trim()) dup.detail = f.detail.trim();
      if (severityOrder(f.severity) > severityOrder(dup.severity)) dup.severity = f.severity;
      continue;
    }
    out.push(f);
  }
  return out.sort((a, b) => severityOrder(b.severity) - severityOrder(a.severity));
}

function severityOrder(s: DriftFinding["severity"]): number {
  return s === "critical" ? 3 : s === "warning" ? 2 : 1;
}

function summarizeDiff(d: ReturnType<typeof diffGraphs>): string {
  const parts = [];
  if (d.addedNodes.length) parts.push(`${d.addedNodes.length} new component${d.addedNodes.length === 1 ? "" : "s"}`);
  if (d.addedEdges.length) parts.push(`${d.addedEdges.length} new dependenc${d.addedEdges.length === 1 ? "y" : "ies"}`);
  if (d.removedEdges.length) parts.push(`${d.removedEdges.length} removed dependenc${d.removedEdges.length === 1 ? "y" : "ies"}`);
  if (d.removedNodes.length) parts.push(`${d.removedNodes.length} removed component${d.removedNodes.length === 1 ? "" : "s"}`);
  return parts.length ? `${parts.join(", ")}.` : "No architectural change.";
}
