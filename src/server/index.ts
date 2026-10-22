// HTTP entry point: POST /run for judges and scripts, a small JSON API and
// the web UI for people.
//   npm start            (PORT, default 8000; HOST, default 127.0.0.1)
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { z } from "zod";
import { providerConfig } from "../config";
import { coverage, lineStatus, listFiles, repositories, zetarisQuery } from "../agent/evidence";
import { runWhy } from "../agent/run";
import { cloneDir } from "../ingest/git";
import { memoryFor } from "../memory/findings";
import { FEEDBACK_DELTAS, type FeedbackKind } from "../memory/hmem";

const PORT = Number(process.env.PORT ?? 8000);
const HOST = process.env.HOST ?? "127.0.0.1";
const WEB = path.join(process.cwd(), "web");

const RunBody = z.object({
  run_id: z.string().optional(),
  input: z.object({
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    question: z.string().min(3).max(2000),
    path: z.string().max(600).optional(),
    line: z.number().int().positive().optional(),
  }),
});

function send(res: ServerResponse, status: number, body: unknown, type = "application/json"): void {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : (body as string));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 100_000) throw Object.assign(new Error("request body too large"), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const repoParam = (url: URL) => {
  const repo = url.searchParams.get("repo") ?? "";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Object.assign(new Error("repo must be owner/name"), { status: 400 });
  return repo;
};

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const q = zetarisQuery;

  if (req.method === "POST" && url.pathname === "/run") {
    const parsed = RunBody.safeParse(await readBody(req));
    if (!parsed.success) return send(res, 400, { status: "error", error: { type: "BadRequest", message: z.prettifyError(parsed.error), recoverable: true } });
    const result = await runWhy(parsed.data.input);
    return send(res, result.status === "success" ? 200 : 502, parsed.data.run_id ? { ...result, request_id: parsed.data.run_id } : result);
  }
  if (req.method === "POST" && url.pathname === "/api/memory/feedback") {
    const body = z.object({ repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/), ids: z.array(z.string()).min(1).max(20), kind: z.enum(Object.keys(FEEDBACK_DELTAS) as [FeedbackKind, ...FeedbackKind[]]) }).parse(await readBody(req));
    const hmem = memoryFor(body.repo);
    const updated = body.ids.filter((id) => hmem.store.get(id)).map((id) => hmem.feedback(id, body.kind));
    return send(res, 200, { updated: updated.map((m) => ({ id: m.id, confidence: m.confidence, tags: m.tags })) });
  }
  if (req.method !== "GET") return send(res, 405, { error: "method not allowed" });

  switch (url.pathname) {
    case "/":
      return send(res, 200, readFileSync(path.join(WEB, "index.html"), "utf8"), "text/html; charset=utf-8");
    case "/api/health": {
      let provider = "not configured";
      try {
        provider = providerConfig().name;
      } catch { /* reported as not configured */ }
      return send(res, 200, { status: "ok", provider });
    }
    case "/api/repos":
      return send(res, 200, await repositories(q));
    case "/api/files": {
      const repo = repoParam(url);
      const [files, cov] = await Promise.all([listFiles(q, repo), coverage(q, repo)]);
      const byPath = new Map(cov.map((c) => [c.path, c]));
      return send(res, 200, files.map((f) => ({ ...f, coverage: byPath.get(f.path) ?? null })));
    }
    case "/api/file": {
      const repo = repoParam(url);
      const file = url.searchParams.get("path") ?? "";
      const root = cloneDir(repo);
      const full = path.join(root, file);
      if (!full.startsWith(root + path.sep) || !existsSync(full)) return send(res, 404, { error: "file not found" });
      return send(res, 200, { path: file, text: readFileSync(full, "utf8"), ranges: await lineStatus(q, `${repo}:${file}`) });
    }
    case "/api/memory": {
      const hmem = memoryFor(repoParam(url));
      const memories = hmem.store.all().sort((a, b) => b.timestamp - a.timestamp).map(({ embedding: _e, ...m }) => ({ ...m, history: hmem.ledger.history(m.id).map((h) => ({ action: h.action, timestamp: h.timestamp, details: h.details })) }));
      return send(res, 200, { memories, ledger: hmem.ledger.stats() });
    }
    case "/api/trace": {
      const id = url.searchParams.get("id") ?? "";
      const file = path.join(process.cwd(), "logs", `trace-${id.replace(/[^\w-]/g, "")}.jsonl`);
      if (!existsSync(file)) return send(res, 404, { error: "trace not found" });
      return send(res, 200, readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
    }
    default:
      return send(res, 404, { error: "not found" });
  }
}

createServer((req, res) => {
  route(req, res).catch((error: Error & { status?: number }) => {
    send(res, error.status ?? 500, { status: "error", error: { type: error.name, message: error.message, recoverable: true } });
  });
}).listen(PORT, HOST, () => console.log(`[cartograph] listening on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`));
