// V2 REST API, mounted at /api/v2 on the same router as V1 (so the host,
// origin, secret-prefix and public-mode rules all apply).
//
//   GET  /projects                         every scanned repository
//   POST /scan            {repo, branch?}  clone + inventory (no model)
//   GET  /jobs/:id                         job progress
//   GET  /projects/:key                    project, coverage, entry index
//   GET  /projects/:key/elements           inventory elements (?kind=&q=&offset=&limit=)
//   GET  /projects/:key/elements/:id       one element: links, slice, code
//   GET  /projects/:key/files              files (?status=unread)
//   POST /projects/:key/analyze {full?}    agents build or extend the feature tree
//   POST /projects/:key/tree   {op…}       edit the feature tree
//   POST /projects/:key/approve            pass the completeness gate
//   POST /projects/:key/stories {featureIds|all, mode, target}
//   POST /projects/:key/backlog {op…}      review epics and stories
//   POST /projects/:key/settings {mode, target}
//   GET  /projects/:key/export.csv|export.md (?drafts=1)
import express, { type Request, type Response, type Router } from "express";
import { resolveRepo } from "../server/repo";
import { assertPublicRepo, isRemote, localRepoAllowed, takeMapBudget, takeVisitorCall, visitorOf, withCaller } from "../server/security";
import type { InventoryElement } from "./inventory/types";
import { excerpts, getJob, runningJob, startAnalyze, startScan, startStories } from "./jobs";
import { coverage, listProjects, loadInventory, loadProject, saveProject, type Project } from "./project";
import { ReviewError, applyBacklogOp, applyTreeOp, approveTree, exportBacklog } from "./review";
import { allSlices, unreached } from "./slices";

function fail(res: Response, status: number, error: string) {
  res.status(status).json({ error });
}

function limited(req: Request, res: Response, action: string): boolean {
  if (isRemote(req) && !takeVisitorCall(visitorOf(req), action)) {
    fail(res, 429, "You've reached this demo's hourly limit for that action. Try again later.");
    return true;
  }
  return false;
}

const unreachedCache = new WeakMap<object, InventoryElement[]>();

function summary(p: Project) {
  const inv = loadInventory(p.key);
  const c = inv ? coverage(p, inv) : undefined;
  return {
    key: p.key, repo: p.repo, sha: p.sha, scannedAt: p.scannedAt, stack: p.stack, summary: p.summary,
    stats: inv?.stats, coverage: c && { ...c, unassigned: c.unassigned.length, duplicated: c.duplicated.length },
    approved: !!p.approval, features: p.domains.reduce((n, d) => n + d.features.length, 0),
    epics: p.epics.length, approvedStories: p.epics.reduce((n, e) => n + e.stories.filter((s) => s.status === "approved").length, 0),
    job: runningJob(p.key)?.id,
  };
}

export function v2Router(): Router {
  const r = express.Router();
  r.use(express.json({ limit: "1mb" }));
  const project = (req: Request, res: Response): Project | undefined => {
    const p = loadProject(String(req.params.key));
    if (!p) fail(res, 404, "No V2 project for that repository. Scan it first.");
    return p;
  };
  const guard = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response) =>
    withCaller(req, async () => {
      try {
        await fn(req, res);
      } catch (error) {
        if (!res.headersSent) fail(res, error instanceof ReviewError ? 400 : 500, (error as Error).message);
      }
    });

  r.get("/projects", guard((_req, res) => {
    res.json({ projects: listProjects().map(summary) });
  }));

  r.post("/scan", guard(async (req, res) => {
    let repo;
    try {
      repo = resolveRepo(String(req.body?.repo ?? ""));
    } catch (error) {
      return fail(res, 400, (error as Error).message);
    }
    if (repo.source === "local" && !localRepoAllowed(repo.location)) return fail(res, 403, "Remote callers may only scan GitHub repositories.");
    try {
      await assertPublicRepo(repo.name);
    } catch (error) {
      return fail(res, 400, (error as Error).message);
    }
    if (limited(req, res, "v2_scan")) return;
    const job = startScan(repo, req.body?.branch ? String(req.body.branch) : undefined);
    res.status(202).json({ jobId: job.id, key: repo.key });
  }));

  r.get("/jobs/:id", guard((req, res) => {
    const job = getJob(String(req.params.id));
    if (!job) return fail(res, 404, "No such job (the server may have restarted).");
    res.json(job);
  }));

  r.get("/projects/:key", guard((req, res) => {
    const p = project(req, res);
    if (!p) return;
    const inv = loadInventory(p.key);
    const byId = new Map(inv?.elements.map((e) => [e.id, e]) ?? []);
    const entryIndex = (inv?.entryPoints ?? []).map((id) => {
      const el = byId.get(id)!;
      return { id, kind: el.kind, name: el.name, file: el.file, line: el.line, http: (el.meta?.http as string[] | undefined)?.[0] ?? (el.meta?.path as string | undefined) ?? (el.meta?.schedule as string | undefined) };
    });
    let orphans = inv ? unreachedCache.get(inv) : undefined;
    if (inv && !orphans) {
      orphans = unreached(inv, allSlices(inv));
      unreachedCache.set(inv, orphans);
    }
    res.json({ project: p, summary: summary(p), coverage: inv ? coverage(p, inv) : null, entryIndex, unreached: orphans?.length ?? 0 });
  }));

  r.get("/projects/:key/elements", guard((req, res) => {
    const p = project(req, res);
    if (!p) return;
    const inv = loadInventory(p.key);
    if (!inv) return fail(res, 404, "No inventory yet");
    const kind = req.query.kind ? String(req.query.kind) : undefined;
    const q = req.query.q ? String(req.query.q).toLowerCase() : undefined;
    let list: InventoryElement[] = inv.elements;
    if (req.query.view === "unreached") {
      list = unreachedCache.get(inv) ?? unreached(inv, allSlices(inv));
      unreachedCache.set(inv, list);
    } else if (req.query.view === "entries") {
      const set = new Set(inv.entryPoints);
      list = list.filter((e) => set.has(e.id));
    }
    if (kind) list = list.filter((e) => e.kind === kind);
    if (q) list = list.filter((e) => e.name.toLowerCase().includes(q) || e.file.toLowerCase().includes(q) || JSON.stringify(e.meta ?? {}).toLowerCase().includes(q));
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200) || 200));
    res.json({ total: list.length, offset, elements: list.slice(offset, offset + limit) });
  }));

  r.get("/projects/:key/elements/:id", guard(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const inv = loadInventory(p.key);
    if (!inv) return fail(res, 404, "No inventory yet");
    const id = String(req.params.id);
    const byId = new Map(inv.elements.map((e) => [e.id, e]));
    const el = byId.get(id);
    if (!el) return fail(res, 404, "No such element");
    const brief = (x: string) => {
      const e = byId.get(x);
      return e ? { id: e.id, kind: e.kind, name: e.name, file: e.file, line: e.line } : { id: x, kind: "unknown", name: x, file: "", line: 0 };
    };
    const outgoing = inv.links.filter((l) => l.from === id).map((l) => ({ ...l, target: brief(l.to) }));
    const incoming = inv.links.filter((l) => l.to === id).map((l) => ({ ...l, source: brief(l.from) }));
    const isEntry = inv.entryPoints.includes(id);
    const slice = isEntry ? allSlices(inv).get(id)?.steps.map((s) => ({ ...s, element: brief(s.id) })) : undefined;
    const code = (await excerpts(p, inv, [id], 120)).get(id);
    res.json({ element: el, outgoing, incoming, slice, code, entry: isEntry ? p.entries[id] ?? null : undefined });
  }));

  r.get("/projects/:key/files", guard((req, res) => {
    const p = project(req, res);
    if (!p) return;
    const inv = loadInventory(p.key);
    if (!inv) return fail(res, 404, "No inventory yet");
    const status = req.query.status ? String(req.query.status) : undefined;
    const list = status ? inv.files.filter((f) => f.status === status) : inv.files;
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    res.json({ total: list.length, offset, files: list.slice(offset, offset + 500) });
  }));

  r.post("/projects/:key/analyze", guard((req, res) => {
    const p = project(req, res);
    if (!p) return;
    if (!loadInventory(p.key)) return fail(res, 400, "Scan the repository first");
    if (runningJob(p.key)) return res.status(202).json({ jobId: runningJob(p.key)!.id });
    if (limited(req, res, "v2_analyze")) return;
    if (!takeMapBudget()) return fail(res, 429, "Today's budget for model runs is used up. Try again tomorrow.");
    const job = startAnalyze(p, { full: !!req.body?.full });
    res.status(202).json({ jobId: job.id });
  }));

  r.post("/projects/:key/tree", guard(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const inv = loadInventory(p.key);
    if (!inv) return fail(res, 400, "Scan the repository first");
    if (runningJob(p.key)?.kind === "analyze") return fail(res, 409, "The agents are still building the tree. Edit it when they finish.");
    const detail = applyTreeOp(p, inv, req.body);
    await saveProject(p);
    res.json({ ok: true, detail, coverage: coverage(p, inv) });
  }));

  r.post("/projects/:key/approve", guard(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const inv = loadInventory(p.key);
    if (!inv) return fail(res, 400, "Scan the repository first");
    if (runningJob(p.key)?.kind === "analyze") return fail(res, 409, "The agents are still building the tree.");
    approveTree(p, inv);
    await saveProject(p);
    res.json({ ok: true, approval: p.approval });
  }));

  r.post("/projects/:key/settings", guard(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const mode = req.body?.mode === "migrate" ? "migrate" : "as-is";
    p.settings = { mode, target: String(req.body?.target ?? "").slice(0, 300) };
    await saveProject(p);
    res.json({ ok: true, settings: p.settings });
  }));

  r.post("/projects/:key/stories", guard((req, res) => {
    const p = project(req, res);
    if (!p) return;
    if (!p.approval) return fail(res, 400, "Approve the feature tree first: stories are only written against an approved tree.");
    if (runningJob(p.key)) return fail(res, 409, "Another job is running for this repository. Try again when it finishes.");
    const all = req.body?.all === true;
    const featureIds: string[] = all
      ? p.domains.flatMap((d) => d.features.filter((f) => !f.outOfScope && !p.epics.some((e) => e.featureId === f.id)).map((f) => f.id))
      : Array.isArray(req.body?.featureIds) ? req.body.featureIds.map(String) : [];
    if (!featureIds.length) return fail(res, 400, all ? "Every in-scope feature already has an epic." : "Pick a feature.");
    if (limited(req, res, "v2_stories")) return;
    const mode = req.body?.mode === "migrate" ? "migrate" : req.body?.mode === "as-is" ? "as-is" : p.settings.mode;
    const target = req.body?.target !== undefined ? String(req.body.target).slice(0, 300) : p.settings.target;
    const job = startStories(p, { featureIds, mode, target, replace: !!req.body?.replace });
    res.status(202).json({ jobId: job.id });
  }));

  r.post("/projects/:key/backlog", guard(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const detail = applyBacklogOp(p, req.body);
    await saveProject(p);
    res.json({ ok: true, detail });
  }));

  const exporter = (format: "csv" | "md") => guard((req, res) => {
    const p = project(req, res);
    if (!p) return;
    const body = exportBacklog(p, loadInventory(p.key), format, { drafts: req.query.drafts === "1" });
    const name = `${p.repo.name.replace(/[^\w.-]+/g, "-")}-backlog.${format}`;
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.type(format === "csv" ? "text/csv" : "text/markdown").send(body);
  });
  r.get("/projects/:key/export.csv", exporter("csv"));
  r.get("/projects/:key/export.md", exporter("md"));
  return r;
}
