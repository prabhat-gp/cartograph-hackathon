import { describe, expect, it } from "vitest";
import { runSql, zetarisConfig, ZetarisError } from "../src/zetaris/client";

const config = { restUrl: "http://z/api/v1.0", orgId: "1", apiKey: "k" };

describe("zetarisConfig", () => {
  it("uses the local install defaults", () => {
    expect(zetarisConfig({ ZETARIS_API_KEY: "k" })).toEqual({ restUrl: "http://localhost:8888/api/v1.0", orgId: "1", apiKey: "k" });
  });

  it("needs an API key", () => {
    expect(() => zetarisConfig({})).toThrow("ZETARIS_API_KEY");
  });
});

describe("runSql", () => {
  it("posts one statement with the required headers", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ data: [[1]], columns: ["one"] }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(runSql("SELECT 1 AS one", { config, fetch: f })).resolves.toEqual({ columns: ["one"], rows: [[1]] });
    const h = seen!.init.headers as Record<string, string>;
    expect(seen!.url).toBe("http://z/api/v1.0/sql-editor/sqls/run");
    expect(h.Authorization).toBe("Bearer k");
    expect(h["X-Org-ID"]).toBe("1");
    expect(h["X-Request-ID"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(seen!.init.body))).toMatchObject({ sql: "SELECT 1 AS one", source: "SqlEditor" });
  });

  it("reports HTTP errors and an unreachable server clearly", async () => {
    const bad = (async () => new Response("bad key", { status: 401 })) as unknown as typeof fetch;
    await expect(runSql("SELECT 1", { config, fetch: bad })).rejects.toThrow(/Zetaris 401: bad key/);
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(runSql("SELECT 1", { config, fetch: down })).rejects.toThrow(ZetarisError);
  });
});
