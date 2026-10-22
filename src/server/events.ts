// MCP Events (draft spec, protocol 2026-07-28): an MCP client subscribes to
// "cartograph.architecture_drift" with a callback URL and signing secret; when a
// push changes a repo's architecture we POST a Standard Webhooks–signed event.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Webhook } from "standardwebhooks";
import { type DriftReport, type Severity, severityRank, shortSha } from "../shared/graph";
import { assertSafeCallbackUrl } from "./security";
import { readDoc, writeDoc } from "./store";

export const DRIFT_EVENT = "cartograph.architecture_drift";

export const EVENT_DEFINITIONS = [
  {
    name: DRIFT_EVENT,
    description:
      "Fires when a push changes a mapped repository's architecture: new or removed components " +
      "and dependencies, layering violations (e.g. frontend querying the database), new " +
      "third-party services, or broken flows. Use it to watch a repo for architecture drift.",
    delivery: ["webhook"],
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository to watch, e.g. \"owner/name\". Omit to watch every mapped repo.",
        },
        minSeverity: {
          type: "string",
          enum: ["info", "warning", "critical"],
          default: "info",
          description: "Only fire for drift at least this severe.",
        },
      },
    },
    payloadSchema: {
      type: "object",
      properties: {
        reportId: { type: "string" },
        repo: { type: "string" },
        fromSha: { type: "string" },
        toSha: { type: "string" },
        severity: { type: "string", enum: ["info", "warning", "critical"] },
        summary: { type: "string" },
        commit: { type: "string", description: "Head commit message" },
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: { severity: { type: "string" }, title: { type: "string" }, detail: { type: "string" } },
          },
        },
        viewUrl: { type: "string" },
      },
    },
  },
] as const;

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TTL_MS = 7 * DEFAULT_TTL_MS;
const MAX_SUBSCRIPTIONS = 200;
const RECENT_EVENTS = 200;

export interface Subscription {
  id: string;
  name: string;
  arguments: { repo?: string; minSeverity?: Severity };
  url: string;
  secret: string;
  /** Canonical identity: same name + arguments + url ⇒ same subscription. */
  identity: string;
  createdAt: string;
  expiresAt: string;
  refreshBefore: string;
  cursor: string;
  lastDeliveryAt: string | null;
  lastError: string | null;
}

interface StoredEvent {
  seq: number;
  eventId: string;
  name: string;
  timestamp: string;
  data: Record<string, unknown>;
}

interface EventLog {
  seq: number;
  recent: StoredEvent[];
}

/** JSON-RPC error with the codes from the MCP Events draft. */
export class EventsError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const subs = () => readDoc<Record<string, Subscription>>("subscriptions", {});
const saveSubs = (all: Record<string, Subscription>) => writeDoc("subscriptions", all);
const eventLog = () => readDoc<EventLog>("events", { seq: 0, recent: [] });

const cursorOf = (seq: number) => `c_${seq}`;
const seqOf = (cursor: string | null | undefined) => (cursor && /^c_\d+$/.test(cursor) ? Number(cursor.slice(2)) : undefined);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------- handlers

export function listEvents() {
  return { events: EVENT_DEFINITIONS };
}

export interface SubscribeParams {
  name: string;
  arguments?: Record<string, unknown>;
  delivery?: { mode?: string; url?: string; secret?: string };
  cursor?: string | null;
  maxAgeMs?: number;
  ttlMs?: number;
}

export async function subscribe(params: SubscribeParams) {
  if (params.name !== DRIFT_EVENT) throw new EventsError(-32011, "NotFound", { kind: "event" });
  const delivery = params.delivery ?? {};
  if ((delivery.mode ?? "webhook") !== "webhook") {
    throw new EventsError(-32014, "Unsupported", { feature: `delivery mode ${delivery.mode}` });
  }
  if (!delivery.url) throw new EventsError(-32602, "InvalidParams", { reason: "delivery.url is required" });
  try {
    await assertSafeCallbackUrl(delivery.url);
  } catch (err) {
    throw new EventsError(-32602, "InvalidParams", { reason: (err as Error).message });
  }
  if (!delivery.secret || delivery.secret.length < 16) {
    throw new EventsError(-32602, "InvalidParams", { reason: "delivery.secret is required (16+ characters)" });
  }
  const args = normalizeArgs(params.arguments ?? {});
  const identity = canonical({ name: params.name, arguments: args, url: delivery.url });
  const all = subs();
  const existing = Object.values(all).find((s) => s.identity === identity);
  if (!existing && Object.keys(all).length >= MAX_SUBSCRIPTIONS) {
    throw new EventsError(-32013, "ResourceExhausted", { limit: "subscriptions" });
  }

  const verify = !existing || existing.secret !== delivery.secret;

  const ttl = Math.min(Math.max(params.ttlMs ?? DEFAULT_TTL_MS, 60_000), MAX_TTL_MS);
  const now = Date.now();
  const log = eventLog();
  const sub: Subscription = {
    id: existing?.id ?? `sub_${randomBytes(8).toString("hex")}`,
    name: params.name,
    arguments: args,
    url: delivery.url,
    secret: delivery.secret,
    identity,
    createdAt: existing?.createdAt ?? new Date(now).toISOString(),
    expiresAt: new Date(now + ttl).toISOString(),
    refreshBefore: new Date(now + ttl * 0.8).toISOString(),
    cursor: params.cursor ?? existing?.cursor ?? cursorOf(log.seq),
    lastDeliveryAt: existing?.lastDeliveryAt ?? null,
    lastError: existing?.lastError ?? null,
  };
  await saveSubs({ ...all, [sub.id]: sub });

  // Verify the callback *after* answering: the host only learns the subscription
  // id from our response, so a synchronous check can't be routed on its side.
  // A failed check is logged but doesn't block deliveries.
  if (verify) {
    setTimeout(() => {
      void verifyCallback(sub.url, sub.secret, sub.id).then((ok) => patchSub(sub.id, { lastError: ok ? null : "verification failed" }));
    }, 1500);
  }

  // Replay events the subscriber missed since its cursor (within maxAgeMs).
  const since = seqOf(params.cursor);
  let truncated = false;
  if (since !== undefined) {
    const oldest = log.recent.at(-1)?.seq ?? log.seq;
    truncated = since < oldest - 1;
    const maxAge = params.maxAgeMs ?? Number.POSITIVE_INFINITY;
    const missed = log.recent
      .filter((e) => e.seq > since && now - Date.parse(e.timestamp) <= maxAge && matches(sub, e.data))
      .sort((a, b) => a.seq - b.seq);
    for (const e of missed) void deliver(sub, e);
  }

  return {
    id: sub.id,
    refreshBefore: sub.refreshBefore,
    cursor: cursorOf(log.seq),
    truncated,
    deliveryStatus: { active: true, lastDeliveryAt: sub.lastDeliveryAt, lastError: sub.lastError },
  };
}

export async function unsubscribe(params: { name?: string; arguments?: Record<string, unknown>; delivery?: { url?: string }; id?: string }) {
  const all = subs();
  const identity = params.name && params.delivery?.url
    ? canonical({ name: params.name, arguments: normalizeArgs(params.arguments ?? {}), url: params.delivery.url })
    : undefined;
  const victim = Object.values(all).find((s) => (params.id && s.id === params.id) || (identity && s.identity === identity));
  if (victim) {
    delete all[victim.id];
    await saveSubs(all);
  }
  return {}; // idempotent
}

function normalizeArgs(raw: Record<string, unknown>): Subscription["arguments"] {
  const out: Subscription["arguments"] = {};
  if (typeof raw.repo === "string" && raw.repo.trim()) out.repo = raw.repo.trim().toLowerCase().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  const sev = raw.minSeverity;
  if (sev !== undefined) {
    if (sev !== "info" && sev !== "warning" && sev !== "critical") throw new EventsError(-32602, "InvalidParams", { reason: "minSeverity" });
    out.minSeverity = sev;
  }
  return out;
}

async function verifyCallback(url: string, secret: string, subscriptionId: string): Promise<boolean> {
  const challenge = randomUUID();
  const body = JSON.stringify({ type: "verification", challenge });
  const shape = secret.startsWith("whsec_") ? `whsec_ (${secret.length} chars)` : `raw (${secret.length} chars)`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: signedHeaders(secret, `verify_${challenge}`, body, subscriptionId),
      body,
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    let echoed: unknown;
    try {
      echoed = (JSON.parse(text) as { challenge?: unknown }).challenge;
    } catch {
      echoed = text.trim();
    }
    const ok = res.ok && echoed === challenge;
    console.log(`[events] verification ${subscriptionId}: HTTP ${res.status}${ok ? " ✓ challenge echoed" : ` ✗ body=${text.slice(0, 300)}`} · secret ${shape}`);
    return ok;
  } catch (err) {
    console.warn(`[events] verification ${subscriptionId} failed: ${(err as Error).message} · secret ${shape}`);
    return false;
  }
}

/** Standard Webhooks signer: "whsec_<base64>" secrets as specified, anything else as raw bytes. */
function signer(secret: string): Webhook {
  try {
    if (secret.startsWith("whsec_")) return new Webhook(secret);
  } catch {
    /* not valid base64 after the prefix: fall through to raw */
  }
  return new Webhook(Buffer.from(secret, "utf8"));
}

function signedHeaders(secret: string, msgId: string, body: string, subscriptionId?: string): Record<string, string> {
  const ts = new Date();
  return {
    "Content-Type": "application/json",
    "webhook-id": msgId,
    "webhook-timestamp": String(Math.floor(ts.getTime() / 1000)),
    "webhook-signature": signer(secret).sign(msgId, ts, body),
    ...(subscriptionId ? { "X-MCP-Subscription-Id": subscriptionId } : {}),
  };
}

// ---------------------------------------------------------------- emit

function matches(sub: Subscription, data: Record<string, unknown>): boolean {
  if (sub.arguments.repo) {
    const repo = String(data.repo ?? "").toLowerCase();
    const want = sub.arguments.repo;
    if (repo !== want && !repo.endsWith(`/${want}`)) return false;
  }
  const min = sub.arguments.minSeverity ?? "info";
  return severityRank(data.severity as Severity) >= severityRank(min);
}

/** Record a drift report as an event and fan it out to matching subscriptions. */
export async function emitDrift(report: DriftReport, publicUrl?: string): Promise<number> {
  if (report.maxSeverity === "none") return 0;
  const log = eventLog();
  const seq = log.seq + 1;
  const event: StoredEvent = {
    seq,
    eventId: `evt_${createHash("sha256").update(report.id).digest("hex").slice(0, 16)}`,
    name: DRIFT_EVENT,
    timestamp: report.at,
    data: {
      reportId: report.id,
      repo: report.repoName,
      fromSha: shortSha(report.fromSha),
      toSha: shortSha(report.toSha),
      severity: report.maxSeverity,
      summary: report.summary,
      commit: report.commits[0]?.message ?? "",
      findings: report.findings.slice(0, 5).map((f) => ({ severity: f.severity, title: f.title, detail: f.detail })),
      ...(publicUrl ? { viewUrl: `${publicUrl}/app?repo=${encodeURIComponent(report.repoKey)}&drift=${report.id}` } : {}),
    },
  };
  await writeDoc("events", { seq, recent: [event, ...log.recent].slice(0, RECENT_EVENTS) });

  const now = Date.now();
  const targets = Object.values(subs()).filter((s) => Date.parse(s.expiresAt) > now && matches(s, event.data));
  await Promise.all(targets.map((s) => deliver(s, event)));
  return targets.length;
}

async function deliver(sub: Subscription, event: StoredEvent): Promise<void> {
  const body = JSON.stringify({
    eventId: event.eventId,
    name: event.name,
    timestamp: event.timestamp,
    data: event.data,
    cursor: cursorOf(event.seq),
  });
  const delays = [0, 1000, 4000, 15000];
  let lastError: string | null = null;
  for (const delay of delays) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      const res = await fetch(sub.url, {
        method: "POST",
        headers: signedHeaders(sub.secret, event.eventId, body, sub.id),
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        await patchSub(sub.id, { lastDeliveryAt: new Date().toISOString(), lastError: null, cursor: cursorOf(event.seq) });
        console.log(`[events] delivered ${event.eventId} → ${sub.id}`);
        return;
      }
      lastError = `HTTP ${res.status}`;
      console.warn(`[events] delivery ${event.eventId} → ${sub.id}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
      if (res.status === 410) {
        // Subscriber is gone for good.
        await unsubscribe({ id: sub.id });
        return;
      }
      if (res.status === 413 || (res.status >= 400 && res.status < 500 && res.status !== 429)) break;
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  await patchSub(sub.id, { lastError });
  console.warn(`[events] delivery of ${event.eventId} to ${sub.id} failed: ${lastError}`);
}

async function patchSub(id: string, patch: Partial<Subscription>): Promise<void> {
  const all = subs();
  if (!all[id]) return;
  all[id] = { ...all[id], ...patch };
  await saveSubs(all);
}

export function subscriptionCount(): number {
  return Object.keys(subs()).length;
}
