// The Cartograph HTTP app. Every sensitive route lives on one router that is mounted
// twice: under the secret prefix /<CARTOGRAPH_ACCESS_TOKEN> (for MCP clients and other
// remote callers) and bare, for this machine only. See security.ts.
//
//   /mcp              MCP endpoint for MCP clients (MCP 2026-07-28 + stateless 2025 fallback)
//   /                 the landing page (site/, exported by `npm run build:site`)
//   /app              the Cartograph UI in a browser (standalone mode)
//   /api/tools/:name  REST access to the tools (standalone UI, scripts, tests)
//   /hooks/local      review a local repo (called from a git post-commit hook)
//   /webhooks/github  GitHub push webhooks (public, but HMAC-signed)
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type Request, type Response } from "express";
import { providerConfig, runtimeLabel } from "../config";
import { subscriptionCount } from "./events";
import { githubWebhook } from "./github";
import { startReviewJob } from "./jobs";
import { appHtml, createCartographServer } from "./mcp";
import { resolveRepo } from "./repo";
import { sponsorStatus } from "./status";
import { ACCESS_TOKEN, hostGuard, isRemote, localOnly, originGuard, takeVisitorCall, withCaller } from "./security";
import { findRepo, getRepo } from "./store";
import { ToolError, appToolImpls, toolImpls } from "./tools";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function createApp(opts: { port: number }): Express {
  /** A scratch clone the standalone UI may commit to ("simulate a push"). Off unless set. */
  const demoRepo = process.env.CARTOGRAPH_DEMO_REPO ? path.resolve(ROOT, process.env.CARTOGRAPH_DEMO_REPO) : undefined;

  const app = express();
  app.disable("x-powered-by");
  // Behind Caddy on the same machine: the visitor's address comes from X-Forwarded-For.
  app.set("trust proxy", "loopback");
  app.use(hostGuard);
  app.use(originGuard);

  // GitHub signs the raw bytes, so this route must not JSON-parse first.
  app.post("/webhooks/github", express.raw({ type: () => true, limit: "25mb" }), githubWebhook);
  app.get("/favicon.ico", (_req: Request, res: Response) => res.status(204).end());

  const api = express.Router();

  api.post("/hooks/local", express.json(), (req: Request, res: Response) => {
    const input = String(req.body?.repo ?? "");
    let key: string | undefined;
    try {
      key = findRepo(input)?.repo.key ?? resolveRepo(input).key;
    } catch {
      key = undefined;
    }
    const job = key && getRepo(key) ? startReviewJob(key, { source: "local" }) : undefined;
    res.status(job ? 202 : 404).json(job ? { jobId: job.id } : { error: "repo not mapped" });
  });

  // MCP: a fresh server per request (stateless), with the caller's trust level in context.
  const mcpNode = toNodeHandler(
    createMcpHandler(() => createCartographServer(), { legacy: "stateless", onerror: (err) => console.error("[mcp]", err) }),
  );
  api.all("/mcp", express.json({ limit: "4mb" }), (req: Request, res: Response) => {
    if (process.env.CARTOGRAPH_DEBUG) console.log(`[mcp] ${req.method} ${(req.body as { method?: string })?.method ?? ""}`);
    void withCaller(req, () => mcpNode(req, res, req.body));
  });

  api.post("/api/tools/:name", express.json({ limit: "2mb" }), async (req: Request, res: Response) => {
    const name = String(req.params.name);
    const impl =
      (toolImpls as Record<string, (a: unknown) => Promise<unknown>>)[name] ??
      (appToolImpls as Record<string, (a: unknown) => Promise<unknown>>)[name];
    if (!impl) {
      res.status(404).json({ error: `unknown tool ${name}` });
      return;
    }
    if (isRemote(req) && !takeVisitorCall(req.ip ?? "unknown", name)) {
      res.status(429).json({ error: "You've reached this demo's hourly limit for that action. Saved maps and answers still work; try again later." });
      return;
    }
    try {
      const out = (await withCaller(req, () => impl(req.body ?? {}))) as Record<string, unknown>;
      // Model-facing tools return { text, structured }; app tools return data directly.
      res.json("structured" in out ? { structuredContent: out.structured, text: out.text, meta: out.meta } : { structuredContent: out });
    } catch (err) {
      res.status(err instanceof ToolError ? 400 : 500).json({ error: (err as Error).message });
    }
  });

  // Demo: simulate a push to the scratch demo repo (standalone UI buttons).
  api.post("/api/demo/:action", (req: Request, res: Response) => {
    const script = { drift: "drift-live-stock.sh", fix: "fix-live-stock.sh" }[String(req.params.action)];
    if (!demoRepo || !script) {
      res.status(404).json({ ok: false, output: "Demo pushes are disabled (set CARTOGRAPH_DEMO_REPO)." });
      return;
    }
    execFile(path.join(ROOT, "demo", script), [demoRepo], { env: { ...process.env, CARTOGRAPH_URL: `http://localhost:${opts.port}` } }, (err, stdout, stderr) => {
      res.json({ ok: !err, output: `${stdout}${stderr}`.trim() || (err ? err.message : "") });
    });
  });

  api.get("/app", async (_req: Request, res: Response) => {
    res.type("html").send(await appHtml({ standalone: true }));
  });
  api.get("/health", async (req: Request, res: Response) => {
    // ?deep=1 for uptime monitors: every sponsor integration, 503 when one fails.
    if (req.query.deep) {
      const sponsors = await sponsorStatus();
      const ok = !sponsors.some((s) => s.status === "fail");
      res.status(ok ? 200 : 503).json({ ok, sponsors });
      return;
    }
    let runtime = "fixture";
    if (process.env.CARTOGRAPH_BRAIN !== "fixture") {
      try {
        runtime = providerConfig().name;
      } catch {
        runtime = "unconfigured";
      }
    }
    res.json({ ok: true, runtime, model: runtimeLabel(), subscriptions: subscriptionCount(), demo: !!demoRepo });
  });
  // The landing page, when it has been built; otherwise straight to the desk.
  const site = path.join(ROOT, "site", "out");
  if (existsSync(path.join(site, "index.html"))) api.use(express.static(site, { index: "index.html", redirect: false }));
  else api.get("/", (req: Request, res: Response) => res.redirect(`${req.baseUrl}/app`));

  // Secret prefix first, so its requests never reach the local-only mount.
  if (ACCESS_TOKEN) app.use(`/${ACCESS_TOKEN}`, api);
  app.use(localOnly, api);
  return app;
}
