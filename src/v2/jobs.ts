// V2 background jobs: scan (clone + inventory, no model), analyze (agents
// build the feature tree) and stories (Story Writer per approved feature).
// One job per repository at a time; progress is kept for the UI to poll.
import { randomUUID } from "node:crypto";
import type { RepoRef } from "../shared/graph";
import { listTree, readEntries, repoDir, syncRepo } from "../server/repo";
import { analyze } from "./agents/analyze";
import { type Asker } from "./agents/run";
import { writeStories } from "./agents/stories";
import { buildInventory } from "./inventory";
import type { Inventory } from "./inventory/types";
import { type Project, type StoryMode, coverage, findFeature, loadInventory, loadProject, log, reconcile, saveInventory, saveProject } from "./project";
import { readForInventory } from "./read";

export type V2JobKind = "scan" | "analyze" | "stories";

export interface V2Job {
  id: string;
  kind: V2JobKind;
  key: string;
  repo: string;
  status: "running" | "done" | "error";
  startedAt: string;
  finishedAt?: string;
  log: { at: string; message: string }[];
  error?: string;
}

const jobs = new Map<string, V2Job>();
const running = new Map<string, V2Job>();
let asker: Asker | undefined;

/** Tests swap the model for a fake. */
export function setAsker(fake: Asker | undefined): void {
  asker = fake;
}

export const MAX_ENTRIES_PER_RUN = () => Number(process.env.CARTOGRAPH_V2_MAX_ENTRIES ?? 400);

export function getJob(id: string): V2Job | undefined {
  return jobs.get(id);
}

export function runningJob(key: string): V2Job | undefined {
  return running.get(key);
}

function start(kind: V2JobKind, key: string, repo: string, work: (say: (m: string) => void) => Promise<void>): V2Job {
  const busy = running.get(key);
  if (busy) return busy;
  const job: V2Job = { id: randomUUID(), kind, key, repo, status: "running", startedAt: new Date().toISOString(), log: [] };
  jobs.set(job.id, job);
  running.set(key, job);
  const say = (message: string) => {
    job.log.push({ at: new Date().toISOString(), message });
    if (job.log.length > 400) job.log.splice(0, job.log.length - 400);
  };
  void work(say)
    .then(() => {
      job.status = "done";
    })
    .catch((error: Error) => {
      job.status = "error";
      job.error = error.message;
      say(`Failed: ${error.message}`);
      console.error(`[v2] ${kind} ${repo}:`, error);
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString();
      running.delete(key);
      // Keep the last 50 jobs.
      if (jobs.size > 50) jobs.delete(jobs.keys().next().value!);
    });
  return job;
}

/** The first lines of each element's own code, read from git at the inventory's commit. */
export async function excerpts(project: Project, inv: Inventory, ids: string[], maxLines = 30): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byId = new Map(inv.elements.map((e) => [e.id, e]));
  const wanted = ids.map((id) => byId.get(id)).filter((e) => !!e);
  if (!wanted.length) return out;
  const dir = repoDir(project.repo);
  let tree;
  try {
    tree = await listTree(dir, inv.sha);
  } catch {
    return out; // checkout gone: agents work from the slices alone
  }
  const files = [...new Set(wanted.map((e) => e.file))];
  const entries = tree.filter((t) => files.includes(t.path));
  const contents = await readEntries(dir, entries);
  const byFile = new Map(entries.map((e, i) => [e.path, contents[i]]));
  for (const el of wanted) {
    const text = byFile.get(el.file);
    if (!text) continue;
    const lines = text.split("\n");
    const from = Math.max(0, el.line - 1);
    const to = Math.min(lines.length, el.endLine && el.endLine > el.line ? Math.min(el.endLine, from + maxLines) : from + maxLines);
    out.set(el.id, lines.slice(from, to).map((l, i) => `${from + i + 1}| ${l}`).join("\n"));
  }
  return out;
}

// ---------------------------------------------------------------- scan

export function startScan(repo: RepoRef, branch?: string): V2Job {
  return start("scan", repo.key, repo.name, async (say) => {
    say(`Fetching ${repo.name}…`);
    const synced = await syncRepo(repo, { branch });
    say(`Reading files at ${synced.sha.slice(0, 7)}…`);
    const source = await readForInventory(synced.dir, synced.sha);
    say(`Parsing ${source.files.length} files${source.unread.length ? ` (${source.unread.length} over the size limit, listed as unread)` : ""}…`);
    const inv = buildInventory(repo.name, synced.sha, source.files, { unread: source.unread });
    say(`Inventory · ${inv.stats.elements} elements, ${inv.stats.links} links, ${inv.stats.entryPoints} entry points, ${inv.stats.unreadFiles} unread files`);
    await saveInventory(repo.key, inv);
    const existing = loadProject(repo.key);
    const project: Project = existing ?? {
      version: 1, key: repo.key, repo, sha: synced.sha, scannedAt: "", stack: [], summary: "",
      entries: {}, domains: [], notes: [], epics: [], settings: { mode: "as-is", target: "" }, history: [],
    };
    project.repo = repo;
    project.branch = synced.branch;
    project.sha = synced.sha;
    project.scannedAt = new Date().toISOString();
    project.stack = inv.stack;
    if (existing) {
      const r = reconcile(project, inv);
      say(`Compared with the last scan: ${r.added} new and ${r.removed} removed entry points`);
    }
    log(project, "scanned", `${synced.sha.slice(0, 7)}: ${inv.stats.entryPoints} entry points`);
    await saveProject(project);
    say("Done");
  });
}

// ---------------------------------------------------------------- analyze

export function startAnalyze(project: Project, opts: { full?: boolean } = {}): V2Job {
  return start("analyze", project.key, project.repo.name, async (say) => {
    const inv = loadInventory(project.key);
    if (!inv) throw new Error("Scan the repository first");
    const full = !!opts.full || project.domains.length === 0;
    const pending = full ? inv.entryPoints.length : coverage(project, inv).unassigned.length;
    const limit = MAX_ENTRIES_PER_RUN();
    if (pending > limit) say(`${pending} entry points to describe; this run takes ${limit}. Run "Analyze new entry points" again to continue.`);
    const firstTargets = (full ? inv.entryPoints : coverage(project, inv).unassigned).slice(0, limit);
    const code = await excerpts(project, inv, firstTargets);
    const result = await analyze(inv, project, code, { ask: asker, full, limit, onProgress: say });
    project.summary = result.summary || project.summary;
    project.entries = full ? result.entries : { ...project.entries, ...result.entries };
    project.domains = result.domains;
    project.notes = full ? result.notes : [...project.notes.filter((n) => n.by === "human"), ...result.notes];
    project.analysis = { sha: inv.sha, at: new Date().toISOString(), agents: result.stats };
    if (full && project.approval) {
      project.approval = undefined;
      log(project, "gate reopened", "the feature tree was rebuilt");
    }
    const c = coverage(project, inv);
    log(project, full ? "analyzed" : "analyzed new entry points", `${result.analysed} entry points described; ${c.assigned}/${c.total} placed`);
    await saveProject(project);
    say(`Done · ${c.assigned} of ${c.total} entry points placed in ${project.domains.reduce((n, d) => n + d.features.length, 0)} features`);
  });
}

// ---------------------------------------------------------------- stories

export function startStories(project: Project, opts: { featureIds: string[]; mode: StoryMode; target?: string; replace?: boolean }): V2Job {
  return start("stories", project.key, project.repo.name, async (say) => {
    const inv = loadInventory(project.key);
    if (!inv) throw new Error("Scan the repository first");
    if (!project.approval) throw new Error("Approve the feature tree first");
    let written = 0;
    for (const featureId of opts.featureIds) {
      const found = findFeature(project, featureId);
      if (!found || found.feature.outOfScope) continue;
      const existing = project.epics.find((e) => e.featureId === featureId);
      if (existing && existing.status === "approved" && !opts.replace) {
        say(`${found.feature.name} already has an approved epic; skipped`);
        continue;
      }
      const code = await excerpts(project, inv, found.feature.entryIds, 24);
      const { epic, stats } = await writeStories({ inv, project, domain: found.domain, feature: found.feature, excerpts: code, mode: opts.mode, target: opts.target }, { ask: asker, onProgress: say });
      project.epics = [...project.epics.filter((e) => e.featureId !== featureId), epic];
      log(project, existing ? "epic rewritten" : "epic drafted", `${epic.title}: ${epic.stories.length} stories (${stats.length} agent calls)`);
      await saveProject(project);
      written++;
      say(`${found.feature.name} · epic with ${epic.stories.length} stories ready for review`);
    }
    say(`Done · ${written} epic${written === 1 ? "" : "s"} drafted`);
  });
}
