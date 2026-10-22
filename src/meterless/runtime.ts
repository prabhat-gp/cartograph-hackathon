// Meterless Runtime (Nightshift) provider contract, Runtime 1.4 / provider
// contract v4 from meterless.ai/engines.html: base URL normalising, connect
// links, and the health states the app shows (online, unauthorized, offline).
export const METERLESS_APP = "cartograph";
export const DEFAULT_BASE_URL = "http://127.0.0.1:8088/v1";
/** A model load inside the runtime can take minutes. */
export const METERLESS_TIMEOUT_MS = 180_000;

/** Accepts host[:port], with or without scheme, /v1, /v1/chat/completions, /v1/models or /healthz. */
export function normalizeBaseUrl(input: string): string {
  let text = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`;
  const url = new URL(text);
  return `${url.origin}/v1`;
}

export interface ConnectLink {
  baseUrl: string;
  apiKey: string;
  model: string;
  app: string;
}

/** http://<host>:<port>/connect#k=<key>[&m=<model>][&n=<app>]; anything else is not a link. */
export function parseConnectLink(text: string): ConnectLink | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!/^\/connect\/?$/.test(url.pathname)) return null;
  const params = new URLSearchParams(url.hash.slice(1));
  const key = params.get("k");
  if (!key) return null;
  return {
    baseUrl: `${url.origin}/v1`,
    apiKey: key,
    model: params.get("m") ?? "meterless/auto",
    app: params.get("n") ?? METERLESS_APP,
  };
}

export type RuntimeState = "online" | "unauthorized" | "offline";

export interface RuntimeHealth {
  state: RuntimeState;
  baseUrl: string;
  modes: string[];
  reason: string;
  checkedAt: string;
}

/** GET /v1/models decides: 401/403 is unauthorized, 200 with meterless ids is online, anything else offline. */
export async function probeRuntime(baseUrl: string, token: string, doFetch: typeof fetch = fetch): Promise<RuntimeHealth> {
  const checkedAt = new Date().toISOString();
  const base = { baseUrl, modes: [] as string[], checkedAt };
  let res: Response;
  try {
    res = await doFetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${token}`, "meterless-app": METERLESS_APP },
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    return { ...base, state: "offline", reason: `runtime not reachable at ${baseUrl} (${error instanceof Error ? error.message : error})` };
  }
  if (res.status === 401 || res.status === 403) {
    return { ...base, state: "unauthorized", reason: "the runtime rejected the access token; paste the token from Nightshift's Console" };
  }
  if (!res.ok) return { ...base, state: "offline", reason: `GET /models answered ${res.status}` };
  const body = (await res.json().catch(() => null)) as { data?: { id?: string }[] } | null;
  const modes = (body?.data ?? []).map((m) => m.id ?? "").filter((id) => id.startsWith("meterless/"));
  if (modes.length === 0) return { ...base, state: "offline", reason: "GET /models answered without meterless/* modes" };
  return { ...base, state: "online", modes, reason: `${modes.length} modes available` };
}

const DETECT_PORTS = [8088, 8090, 8787, 11434];
const DETECT_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

/** Tries the usual ports and hosts; returns the first online or unauthorized runtime. */
export async function autoDetect(token: string, doFetch: typeof fetch = fetch): Promise<RuntimeHealth | null> {
  for (const port of DETECT_PORTS) {
    for (const host of DETECT_HOSTS) {
      const health = await probeRuntime(`http://${host}:${port}/v1`, token, doFetch);
      if (health.state !== "offline") return health;
    }
  }
  return null;
}
