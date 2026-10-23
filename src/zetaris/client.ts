// Zetaris over REST: one Lightning SQL statement per POST to
// /sql-editor/sqls/run, authenticated with a bearer token, the organisation id
// and a fresh request id. Rows come back as arrays in column order.
//
// The bearer is the API key when it works. The local bundle can refuse API
// keys with 400 {"msg":"Not Allowed"}, so with ZETARIS_USERNAME/PASSWORD set we
// fall back to the web console's login (POST <ui>/api/auth/login) and use the
// idToken it returns, refreshing it once on a 401.
import { randomUUID } from "node:crypto";

export interface ZetarisConfig {
  restUrl: string;
  uiUrl: string;
  orgId: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

export function zetarisConfig(env: NodeJS.ProcessEnv = process.env): ZetarisConfig {
  const config: ZetarisConfig = {
    restUrl: (env.ZETARIS_REST_URL ?? "http://localhost:8888/api/v1.0").replace(/\/$/, ""),
    uiUrl: (env.ZETARIS_UI_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    orgId: env.ZETARIS_ORG_ID ?? "1",
    apiKey: env.ZETARIS_API_KEY || undefined,
    username: env.ZETARIS_USERNAME || undefined,
    password: env.ZETARIS_PASSWORD || undefined,
  };
  if (!config.apiKey && !(config.username && config.password)) {
    throw new Error("Set ZETARIS_API_KEY, or ZETARIS_USERNAME and ZETARIS_PASSWORD (your Zetaris sign-in)");
  }
  return config;
}

export interface SqlResult {
  columns: string[];
  rows: unknown[][];
}

interface RunResponse {
  data?: unknown[][];
  headers?: string[];
  columns?: (string | { name?: string })[];
  schema?: { name?: string }[];
}

export class ZetarisError extends Error {
  override name = "ZetarisError";
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

type Fetch = typeof fetch;

/** Login tokens per sign-in, shared by every call in this process. */
const loginTokens = new Map<string, string>();

async function login(config: ZetarisConfig, doFetch: Fetch): Promise<string> {
  const key = `${config.uiUrl}|${config.username}`;
  const cached = loginTokens.get(key);
  if (cached) return cached;
  let res: Response;
  try {
    res = await doFetch(`${config.uiUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-ID": randomUUID() },
      body: JSON.stringify({ username: config.username, password: config.password }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new ZetarisError(`Zetaris console not reachable at ${config.uiUrl} (${error instanceof Error ? error.message : error}). Is the SSH tunnel up?`);
  }
  if (!res.ok) throw new ZetarisError(`Zetaris login failed: HTTP ${res.status}`, res.status);
  const body = (await res.json()) as Record<string, unknown>;
  const token = [body.idToken, body.token, body.accessToken].find((t): t is string => typeof t === "string" && t.length > 0);
  if (!token) throw new ZetarisError("Zetaris login did not return an access token");
  loginTokens.set(key, token);
  return token;
}

function forgetLogin(config: ZetarisConfig): void {
  loginTokens.delete(`${config.uiUrl}|${config.username}`);
}

async function post(config: ZetarisConfig, token: string, sql: string, limit: number, doFetch: Fetch): Promise<Response> {
  try {
    return await doFetch(`${config.restUrl}/sql-editor/sqls/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Org-ID": config.orgId,
        "X-Request-ID": randomUUID(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ queryId: randomUUID(), sql, source: "SqlEditor", limit }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new ZetarisError(`Zetaris not reachable at ${config.restUrl} (${error instanceof Error ? error.message : error}). Is the SSH tunnel up?`);
  }
}

async function failure(res: Response): Promise<ZetarisError> {
  const detail = res.headers.get("content-type")?.includes("text/html") ? "HTML page returned; check ZETARIS_REST_URL" : (await res.text()).slice(0, 500);
  return new ZetarisError(`Zetaris ${res.status}: ${detail}`, res.status);
}

/** Runs exactly one statement. Zetaris rejects batches, so callers split their own. */
export async function runSql(sql: string, opts: { config?: ZetarisConfig; limit?: number; fetch?: Fetch } = {}): Promise<SqlResult> {
  const config = opts.config ?? zetarisConfig();
  const doFetch = opts.fetch ?? fetch;
  const limit = opts.limit ?? 1000;
  const canLogin = Boolean(config.username && config.password);

  let res: Response | undefined;
  if (config.apiKey) {
    res = await post(config, config.apiKey, sql, limit, doFetch);
    // 400 Not Allowed / 401 / 403 on an API key: try the sign-in instead.
    if (!res.ok && canLogin && [400, 401, 403].includes(res.status)) {
      const text = await res.clone().text();
      if (res.status !== 400 || /not allowed/i.test(text)) res = undefined;
    }
  }
  if (!res) {
    res = await post(config, await login(config, doFetch), sql, limit, doFetch);
    if (res.status === 401) {
      forgetLogin(config);
      res = await post(config, await login(config, doFetch), sql, limit, doFetch);
    }
  }
  if (!res.ok) throw await failure(res);
  const body = (await res.json()) as RunResponse;
  const columns = (body.headers ?? body.columns ?? body.schema ?? []).map((c) => (typeof c === "string" ? c : c.name ?? ""));
  return { columns, rows: body.data ?? [] };
}

/** Rows as objects keyed by column name. */
export function asObjects(result: SqlResult): Record<string, unknown>[] {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((c, i) => [c, row[i]])));
}
