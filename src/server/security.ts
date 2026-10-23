// Security model for a laptop-hosted MCP server exposed through a public tunnel.
//
//  - Remote callers (anything arriving through the tunnel) must use the secret
//    path prefix /<CARTOGRAPH_ACCESS_TOKEN>/…; without it every route 404s. A remote
//    MCP client is configured with that URL, so the URL is the credential.
//  - Local callers (this machine) may use the bare routes.
//  - Host and Origin checks stop DNS-rebinding and drive-by requests from
//    websites open in the user's browser.
//  - Requests from remote MCP clients may only map GitHub repos, never local
//    folders (a prompt-injected model must not be able to read local code).
//  - MCP Events callbacks may not point into private networks (SSRF).
//  - Full maps are capped per day so a leaked URL can't drain API credits.
//  - Public mode (CARTOGRAPH_PUBLIC=1, a hosted demo): the bare routes are open
//    to everyone, visitors may only map public GitHub repos, and each visitor's
//    expensive tool calls are rate-limited.
import { AsyncLocalStorage } from "node:async_hooks";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";

export const ACCESS_TOKEN = process.env.CARTOGRAPH_ACCESS_TOKEN?.trim() || undefined;
export const PUBLIC_MODE = process.env.CARTOGRAPH_PUBLIC === "1";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostname(hostHeader: string | undefined): string {
  return (hostHeader ?? "").replace(/:\d+$/, "").toLowerCase();
}

/** True when the request came through the public tunnel rather than from this machine. */
export function isRemote(req: Request): boolean {
  // Cloudflare stamps every tunnelled request; clients can't strip these.
  if (req.header("cf-ray") || req.header("cf-connecting-ip")) return true;
  return !LOOPBACK_HOSTS.has(hostname(req.header("host")));
}

// ---------------------------------------------------------------- request context

interface CallContext {
  remote: boolean;
}
const context = new AsyncLocalStorage<CallContext>();

/** Run `fn` with the caller's trust level visible to tool implementations. */
export function withCaller<T>(req: Request, fn: () => T): T {
  return context.run({ remote: isRemote(req) }, fn);
}

export function callerIsRemote(): boolean {
  // No context (direct function calls, tests) = trusted local code.
  return context.getStore()?.remote ?? false;
}

// ---------------------------------------------------------------- middleware

function allowedHosts(): string[] {
  const out = [...LOOPBACK_HOSTS];
  const pub = process.env.PUBLIC_URL;
  if (pub) {
    try {
      out.push(new URL(pub).hostname.toLowerCase());
    } catch {
      /* ignore malformed PUBLIC_URL */
    }
  }
  return out;
}

/** DNS-rebinding guard: only answer for our own host names. */
export function hostGuard(req: Request, res: Response, next: NextFunction): void {
  const host = hostname(req.header("host"));
  if (allowedHosts().includes(host) || host.endsWith(".trycloudflare.com")) return next();
  res.status(403).json({ error: "unknown host" });
}

function originAllowed(origin: string, req: Request): boolean {
  try {
    const o = new URL(origin);
    // Same origin (the Cartograph UI itself), or a localhost dev tool such as MCP Inspector.
    if (o.host === req.header("host")) return true;
    return LOOPBACK_HOSTS.has(o.hostname) && !isRemote(req);
  } catch {
    return false;
  }
}

/** CORS for trusted origins only; reject cross-site browser requests outright. */
export function originGuard(req: Request, res: Response, next: NextFunction): void {
  const origin = req.header("origin");
  if (origin && origin !== "null") {
    if (!originAllowed(origin, req)) {
      res.status(403).json({ error: "cross-origin request blocked" });
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type,authorization,mcp-protocol-version,mcp-session-id,last-event-id,mcp-method,mcp-name");
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id,mcp-protocol-version");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
}

/** Bare (token-less) routes are for this machine only, unless the server is public. */
export function localOnly(req: Request, res: Response, next: NextFunction): void {
  if (PUBLIC_MODE || !isRemote(req)) return next();
  res.status(404).send("Not found");
}

// ---------------------------------------------------------------- local repositories

function allowlist(): string[] {
  return (process.env.CARTOGRAPH_LOCAL_REPOS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p));
}

/** May the current caller map this local folder? */
export function localRepoAllowed(dir: string): boolean {
  if (!callerIsRemote()) return true;
  const target = path.resolve(dir);
  return allowlist().some((a) => target === a);
}

// ---------------------------------------------------------------- MCP Events callbacks

function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const v6 = ip.toLowerCase();
    if (v6 === "::1" || v6 === "::") return true;
    if (v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80")) return true;
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}

/**
 * Reject callback URLs that would make this laptop send requests into private
 * networks (router admin pages, other local services). Throws with a reason.
 */
export async function assertSafeCallbackUrl(raw: string): Promise<void> {
  if (process.env.CARTOGRAPH_ALLOW_PRIVATE_CALLBACKS === "1") return; // local testing only
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("delivery.url is not a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("delivery.url must use https");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw new Error("delivery.url host does not resolve");
  if (addresses.some(isPrivateAddress)) throw new Error("delivery.url points into a private network");
}

// ---------------------------------------------------------------- public repos only

/**
 * In public mode a visitor may only map repositories GitHub shows to anyone:
 * the server's token can read private repos, and their code must not leak.
 * Throws with a reason the visitor can act on.
 */
export async function assertPublicRepo(name: string, doFetch: typeof fetch = fetch): Promise<void> {
  if (!PUBLIC_MODE || !callerIsRemote()) return;
  const res = await doFetch(`https://api.github.com/repos/${name}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "cartograph" },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
  if (res?.status === 404) throw new Error(`${name} isn't a public GitHub repository. This demo maps public repositories only.`);
  if (!res?.ok) throw new Error("GitHub didn't answer whether the repository is public. Try again in a minute.");
  const repo = (await res.json()) as { private?: boolean };
  if (repo.private !== false) throw new Error(`${name} isn't a public GitHub repository. This demo maps public repositories only.`);
}

// ---------------------------------------------------------------- per-visitor limits

/** Calls per visitor per hour for the tools that spend model credits. */
const HOURLY_LIMITS: Record<string, number> = { map_repo: 3, check_drift: 6, explain_dependency: 20, trace_flow: 20, why_coverage: 20 };
const calls = new Map<string, number[]>();

/** Counts one call; false when this visitor is over the hour's limit for this tool. */
export function takeVisitorCall(visitor: string, tool: string, now = Date.now()): boolean {
  const limit = HOURLY_LIMITS[tool];
  if (!limit) return true;
  const key = `${visitor} ${tool}`;
  const recent = (calls.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= limit) {
    calls.set(key, recent);
    return false;
  }
  recent.push(now);
  calls.set(key, recent);
  return true;
}

// ---------------------------------------------------------------- cost guard

const MAX_MAPS_PER_DAY = Number(process.env.CARTOGRAPH_MAX_MAPS_PER_DAY ?? 25);
const mapsByDay = new Map<string, number>();

/** Count one full (non-cached) agent map against today's budget. */
export function takeMapBudget(): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const used = mapsByDay.get(day) ?? 0;
  if (used >= MAX_MAPS_PER_DAY) return false;
  mapsByDay.set(day, used + 1);
  return true;
}
