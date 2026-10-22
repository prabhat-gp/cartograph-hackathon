// The Cartograph MCP server: tools, the UI resource (an MCP App any MCP Apps host
// can render: Claude, Cursor and others) and MCP Events. A fresh instance is built
// per request (stateless HTTP).
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer, ProtocolError } from "@modelcontextprotocol/server";
import * as z from "zod";
import { EventsError, listEvents, subscribe, unsubscribe } from "./events";
import { ToolError, type ToolOutput, appToolImpls, toolImpls } from "./tools";

export const APP_URI = "ui://cartograph/app.html";
export const APP_MIME = "text/html;profile=mcp-app";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APP_HTML = path.join(ROOT, "dist/web/index.html");

/** Monochrome 20×20 sidebar icon (currentColor), per the plugin icon guidelines. */
const ICON = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"><path d="M2.67 5.33 7.33 3.33l5.34 2.34 4.66-2v11l-4.66 2-5.34-2.34-4.66 2z"/><path d="M7.33 3.33v11M12.67 5.67v11" opacity=".5"/><circle cx="5.2" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="9.6" r="1" fill="currentColor" stroke="none"/><circle cx="14.9" cy="8.3" r="1.3" fill="currentColor" stroke="none"/></svg>',
).toString("base64")}`;

const INSTRUCTIONS = `Cartograph maps the architecture of a code repository and keeps the map current on every push.
- map_repo: map a GitHub repo (or reuse the cached map). Mapping runs in the background with live progress in the Cartograph view.
- trace_flow: answer "what happens when …" by animating a request hop by hop, with the code behind each step.
- blast_radius: "what breaks if X goes down?"
- explain_component: details and cited dependencies of one component.
- architecture_drift: show how recent pushes changed the architecture (layering violations, new dependencies).
Every dependency Cartograph shows is backed by a file:line citation from the code; Cartograph drops anything it can't cite.
When a cartograph.architecture_drift event arrives, call architecture_drift with its repo and reportId to show it, then explain the most severe finding in one or two sentences.`;

export async function appHtml(opts: { standalone?: boolean } = {}): Promise<string> {
  const html = existsSync(APP_HTML)
    ? await readFile(APP_HTML, "utf8")
    : "<!doctype html><meta charset=utf-8><body style='font:14px system-ui;padding:24px'>Cartograph UI not built yet: run <code>npm run build:web</code>.</body>";
  if (!opts.standalone) return html;
  return html.replace("<head>", `<head><script>window.__CARTOGRAPH_STANDALONE__=true</script>`);
}

function toResult(out: ToolOutput) {
  return {
    content: [{ type: "text" as const, text: out.text }],
    structuredContent: out.structured,
    ...(out.meta ? { _meta: out.meta } : {}),
  };
}

function toErrorResult(err: unknown) {
  const message = err instanceof ToolError ? err.message : `Cartograph error: ${(err as Error).message ?? String(err)}`;
  if (!(err instanceof ToolError)) console.error(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

const repoArg = z.string().optional().describe('Repository, e.g. "owner/name" or a GitHub URL. Defaults to the most recently mapped repo.');

/** _meta for tools that render the Cartograph view (MCP Apps). */
function uiMeta(_opts: { invoking: string; invoked: string; fullscreen?: boolean; entrypoints?: boolean }) {
  return { ui: { resourceUri: APP_URI, visibility: ["model", "app"] } };
}

const appOnly = { ui: { visibility: ["app"] } };
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export function createCartographServer(): McpServer {
  const server = new McpServer(
    {
      name: "cartograph",
      title: "Cartograph",
      version: "0.1.0",
      description: "Google Maps for your codebase: a live, verified architecture map of any repository.",
      icons: [{ src: ICON, mimeType: "image/svg+xml", sizes: ["20x20"] }],
    },
    {
      // `events` = MCP Events (draft). Cast: not yet part of the SDK's capability types.
      capabilities: { tools: {}, resources: {}, events: { listChanged: false } } as Record<string, object>,
      instructions: INSTRUCTIONS,
    },
  );

  // ---------------------------------------------------------------- UI resource
  const resourceMeta = {
    ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
  };
  server.registerResource(
    "cartograph-app",
    APP_URI,
    { title: "Cartograph", description: "The Cartograph architecture map", mimeType: APP_MIME, _meta: resourceMeta },
    async () => ({ contents: [{ uri: APP_URI, mimeType: APP_MIME, text: await appHtml(), _meta: resourceMeta }] }),
  );

  // ---------------------------------------------------------------- model-facing tools
  const tool = <S extends z.ZodObject>(
    name: keyof typeof toolImpls,
    config: { title: string; description: string; inputSchema: S; _meta?: Record<string, unknown>; annotations?: Record<string, boolean> },
  ) => {
    const impl = toolImpls[name] as (args: z.infer<S>) => Promise<ToolOutput>;
    server.registerTool(
      name,
      // Cast: the SDK's overloads don't accept a generic Zod type parameter.
      { ...config, inputSchema: config.inputSchema as z.ZodObject, icons: [{ src: ICON, mimeType: "image/svg+xml" }], annotations: { ...readOnly, ...config.annotations } },
      async (args) => {
        try {
          return toResult(await impl(args as z.infer<S>));
        } catch (err) {
          return toErrorResult(err);
        }
      },
    );
  };

  tool("cartograph", {
    title: "Cartograph",
    description: "Open Cartograph: the interactive architecture map of your mapped repositories.",
    inputSchema: z.object({ repo: repoArg }),
    _meta: uiMeta({ invoking: "Opening Cartograph…", invoked: "Cartograph is open", entrypoints: true, fullscreen: true }),
  });

  tool("map_repo", {
    title: "Map a repository",
    description:
      "Map the architecture of a GitHub repository: its components (frontends, APIs, services, workers, databases, " +
      "queues, third-party services), the dependencies between them with file:line evidence, and its main request flows. " +
      "Use when the user wants to understand, onboard onto, or visualise a codebase. Returns quickly; mapping continues " +
      "in the background with live progress in the Cartograph view.",
    inputSchema: z.object({
      repo: z.string().describe('GitHub repo URL or "owner/name"'),
      branch: z.string().optional().describe("Branch to map (default: the repo's default branch)"),
      force: z.boolean().optional().describe("Re-map even if this commit is already mapped"),
    }),
    _meta: uiMeta({ invoking: "Mapping the repository…", invoked: "Map ready", fullscreen: true }),
    annotations: { idempotentHint: false, openWorldHint: true },
  });

  tool("trace_flow", {
    title: "Trace a flow",
    description:
      'Answer "what happens when …" questions (e.g. "what happens when a user places an order?") by tracing the request ' +
      "hop by hop through the mapped architecture. Animates the path in the Cartograph view with the code behind each step.",
    inputSchema: z.object({ question: z.string().describe("The user's question about a flow or request"), repo: repoArg }),
    _meta: uiMeta({ invoking: "Tracing the flow…", invoked: "Flow traced" }),
  });

  tool("blast_radius", {
    title: "Blast radius",
    description: 'Show what breaks if a component goes down ("what if Redis dies?"): impacted components and broken flows.',
    inputSchema: z.object({ component: z.string().describe('Component name or id, e.g. "Redis" or "orders-api"'), repo: repoArg }),
    _meta: uiMeta({ invoking: "Simulating the outage…", invoked: "Blast radius ready" }),
  });

  tool("explain_component", {
    title: "Explain a component",
    description: "Explain one component of the mapped architecture: its role, files, and every dependency in and out with file:line citations.",
    inputSchema: z.object({ component: z.string().describe("Component name or id"), repo: repoArg }),
  });

  tool("architecture_drift", {
    title: "Architecture drift",
    description:
      "Show how recent pushes changed the architecture: new or removed components and dependencies, layering violations " +
      "(e.g. a frontend querying the database directly), new third-party services and broken flows. Call this when an " +
      "cartograph.architecture_drift event arrives, passing its reportId.",
    inputSchema: z.object({
      repo: repoArg,
      reportId: z.string().optional().describe("A specific drift report id (from an cartograph.architecture_drift event)"),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    _meta: uiMeta({ invoking: "Checking architecture drift…", invoked: "Drift report ready" }),
  });

  tool("check_drift", {
    title: "Check for drift now",
    description: "Review commits pushed since the last map right now (instead of waiting for the GitHub webhook).",
    inputSchema: z.object({ repo: repoArg }),
    _meta: uiMeta({ invoking: "Reviewing new commits…", invoked: "Review started" }),
    annotations: { idempotentHint: false, openWorldHint: true },
  });

  // ---------------------------------------------------------------- app-only tools (UI data)
  const appTool = <S extends z.ZodObject>(name: keyof typeof appToolImpls, description: string, inputSchema: S, alias?: string) => {
    const impl = appToolImpls[name] as (args: z.infer<S>) => Promise<Record<string, unknown>>;
    server.registerTool(alias ?? name, { description, inputSchema: inputSchema as z.ZodObject, annotations: readOnly, _meta: appOnly }, async (args) => {
      try {
        const data = await impl(args as z.infer<S>);
        return { content: [{ type: "text" as const, text: "ok" }], structuredContent: data };
      } catch (err) {
        return toErrorResult(err);
      }
    });
  };
  appTool("cartograph_graph", "Full graph for the Cartograph UI", z.object({ repo: z.string().optional(), sha: z.string().optional() }));
  appTool("cartograph_job", "Mapping job progress for the Cartograph UI", z.object({ jobId: z.string() }));
  appTool("cartograph_changes", "Drift reports newer than a given one, for live updates", z.object({ repo: z.string().optional(), after: z.string().optional() }));
  appTool("cartograph_repos", "Mapped repositories", z.object({}));

  // ---------------------------------------------------------------- MCP Events
  // The protocol is a draft and hosts differ in field names, so parameters are
  // accepted loosely, normalised here, and every call is logged (secrets masked).
  const masked = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(masked)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, /secret|token|signature/i.test(k) ? "***" : masked(x)]))
        : v;
  const wrap = (method: string, fn: (p: Record<string, unknown>) => unknown) => async (params: unknown) => {
    const p = (params ?? {}) as Record<string, unknown>;
    try {
      const result = (await fn(p)) as Record<string, unknown>;
      console.log(`[events] ${method} ok · params=${JSON.stringify(masked(p)).slice(0, 600)}`);
      return result;
    } catch (err) {
      const data = err instanceof EventsError ? JSON.stringify(err.data ?? {}) : "";
      console.warn(`[events] ${method} FAILED: ${(err as Error).message} ${data} · params=${JSON.stringify(masked(p)).slice(0, 1200)}`);
      if (err instanceof EventsError) throw new ProtocolError(err.code, err.message, err.data);
      throw err;
    }
  };
  const str = (...xs: unknown[]) => xs.find((x): x is string => typeof x === "string" && x.length > 0);
  const obj = (...xs: unknown[]) => (xs.find((x) => x && typeof x === "object" && !Array.isArray(x)) ?? {}) as Record<string, unknown>;
  const normalise = (p: Record<string, unknown>) => {
    const d = obj(p.delivery, p.webhook, p.callback);
    return {
      name: str(p.name, p.event, p.eventName, p.event_name) ?? "",
      arguments: obj(p.arguments, p.args, p.filter, p.params),
      delivery: {
        mode: str(d.mode, d.type, p.mode) ?? "webhook",
        url: str(d.url, d.callbackUrl, d.callback_url, d.endpoint, p.callbackUrl, p.callback_url, p.url),
        secret: str(d.secret, d.signingSecret, d.signing_secret, p.secret, p.signingSecret, p.signing_secret),
      },
      cursor: str(p.cursor) ?? null,
      maxAgeMs: typeof p.maxAgeMs === "number" ? p.maxAgeMs : undefined,
      ttlMs: typeof p.ttlMs === "number" ? p.ttlMs : undefined,
      id: str(p.id, p.subscriptionId, p.subscription_id),
    };
  };
  const loose = z.looseObject({}).optional();
  server.server.setRequestHandler("events/list", { params: loose }, wrap("events/list", () => listEvents()));
  server.server.setRequestHandler("events/subscribe", { params: loose }, wrap("events/subscribe", (p) => subscribe(normalise(p))));
  server.server.setRequestHandler(
    "events/unsubscribe",
    { params: loose },
    wrap("events/unsubscribe", (p) => {
      const n = normalise(p);
      return unsubscribe({ name: n.name || undefined, id: n.id, arguments: n.arguments, delivery: { url: n.delivery.url } });
    }),
  );

  return server;
}
