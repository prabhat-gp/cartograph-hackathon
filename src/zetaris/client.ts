// Zetaris over REST: one Lightning SQL statement per POST to
// /sql-editor/sqls/run, authenticated with an API key, the organisation id and
// a fresh request id. Rows come back as arrays in column order.
import { randomUUID } from "node:crypto";

export interface ZetarisConfig {
  restUrl: string;
  orgId: string;
  apiKey: string;
}

export function zetarisConfig(env: NodeJS.ProcessEnv = process.env): ZetarisConfig {
  if (!env.ZETARIS_API_KEY) throw new Error("ZETARIS_API_KEY is not set (create one in the Zetaris web interface)");
  return {
    restUrl: (env.ZETARIS_REST_URL ?? "http://localhost:8888/api/v1.0").replace(/\/$/, ""),
    orgId: env.ZETARIS_ORG_ID ?? "1",
    apiKey: env.ZETARIS_API_KEY,
  };
}

export interface SqlResult {
  columns: string[];
  rows: unknown[][];
}

interface RunResponse {
  data?: unknown[][];
  columns?: (string | { name?: string })[];
  schema?: { name?: string }[];
}

export class ZetarisError extends Error {
  override name = "ZetarisError";
}

/** Runs exactly one statement. Zetaris rejects batches, so callers split their own. */
export async function runSql(sql: string, opts: { config?: ZetarisConfig; limit?: number; fetch?: typeof fetch } = {}): Promise<SqlResult> {
  const config = opts.config ?? zetarisConfig();
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${config.restUrl}/sql-editor/sqls/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "X-Org-ID": config.orgId,
        "X-Request-ID": randomUUID(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ queryId: randomUUID(), sql, source: "SqlEditor", limit: opts.limit ?? 1000 }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new ZetarisError(`Zetaris not reachable at ${config.restUrl} (${error instanceof Error ? error.message : error}). Is the SSH tunnel up?`);
  }
  if (!res.ok) {
    const detail = res.headers.get("content-type")?.includes("text/html") ? "HTML page returned; check ZETARIS_REST_URL" : (await res.text()).slice(0, 500);
    throw new ZetarisError(`Zetaris ${res.status}: ${detail}`);
  }
  const body = (await res.json()) as RunResponse;
  const columns = (body.columns ?? body.schema ?? []).map((c) => (typeof c === "string" ? c : c.name ?? ""));
  return { columns, rows: body.data ?? [] };
}
