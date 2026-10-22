import { describe, expect, it } from "vitest";
import { runSql, zetarisConfig, ZetarisError } from "../src/zetaris/client";

const config = { restUrl: "http://z/api/v1.0", uiUrl: "http://ui", orgId: "1", apiKey: "k" };

describe("zetarisConfig", () => {
  it("uses the local install defaults", () => {
    expect(zetarisConfig({ ZETARIS_API_KEY: "k" })).toMatchObject({ restUrl: "http://localhost:8888/api/v1.0", uiUrl: "http://localhost:3000", orgId: "1", apiKey: "k" });
  });

  it("needs an API key or a sign-in", () => {
    expect(() => zetarisConfig({})).toThrow("ZETARIS_API_KEY");
    expect(() => zetarisConfig({ ZETARIS_USERNAME: "u" })).toThrow("ZETARIS_PASSWORD");
    expect(zetarisConfig({ ZETARIS_USERNAME: "u", ZETARIS_PASSWORD: "p" }).apiKey).toBeUndefined();
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

describe("runSql sign-in fallback", () => {
  const ok = () => new Response(JSON.stringify({ data: [[1]], columns: ["one"] }), { status: 200 });

  function server(handler: (url: string, auth: string | undefined) => Response) {
    const calls: { url: string; auth?: string }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      calls.push({ url, auth });
      return handler(url, auth);
    }) as unknown as typeof fetch;
    return { f, calls };
  }

  it("signs in when the API key is refused with Not Allowed", async () => {
    const s = server((url, auth) => {
      if (url.endsWith("/api/auth/login")) return new Response(JSON.stringify({ idToken: "id-1" }), { status: 200 });
      return auth === "Bearer k" ? new Response('{"msg":"Not Allowed"}', { status: 400 }) : ok();
    });
    const cfg = { ...config, uiUrl: "http://ui-a", username: "u", password: "p" };
    await expect(runSql("SELECT 1", { config: cfg, fetch: s.f })).resolves.toMatchObject({ rows: [[1]] });
    expect(s.calls.map((c) => [c.url, c.auth])).toEqual([
      ["http://z/api/v1.0/sql-editor/sqls/run", "Bearer k"],
      ["http://ui-a/api/auth/login", undefined],
      ["http://z/api/v1.0/sql-editor/sqls/run", "Bearer id-1"],
    ]);
  });

  it("keeps a real SQL error from the API key instead of signing in", async () => {
    const s = server(() => new Response("Table or view not found", { status: 400 }));
    const cfg = { ...config, uiUrl: "http://ui-b", username: "u", password: "p" };
    await expect(runSql("SELECT * FROM nope", { config: cfg, fetch: s.f })).rejects.toThrow(/not found/);
    expect(s.calls).toHaveLength(1);
  });

  it("uses only the sign-in when there is no API key, and refreshes an expired token once", async () => {
    let logins = 0;
    let first = true;
    const s = server((url) => {
      if (url.endsWith("/api/auth/login")) return new Response(JSON.stringify({ idToken: `id-${++logins}` }), { status: 200 });
      if (first) {
        first = false;
        return new Response("expired", { status: 401 });
      }
      return ok();
    });
    const cfg = { restUrl: "http://z/api/v1.0", uiUrl: "http://ui-c", orgId: "1", username: "u", password: "p" };
    await expect(runSql("SELECT 1", { config: cfg, fetch: s.f })).resolves.toMatchObject({ rows: [[1]] });
    expect(logins).toBe(2);
    expect(s.calls.at(-1)!.auth).toBe("Bearer id-2");
  });
});
