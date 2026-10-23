// Security tests for the tunnel-exposed server: secret prefix, local-only
// routes, DNS-rebinding/Origin guards, local-folder lockout for remote MCP clients,
// MCP Events SSRF guard, signed GitHub webhooks.
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TOKEN = "test-token-0123456789abcdefghijklmnopqrstuv";
const tmp = mkdtempSync(path.join(tmpdir(), "cartograph-sec-"));
const localRepo = path.join(tmp, "chai-commerce");
process.env.CARTOGRAPH_ACCESS_TOKEN = TOKEN;
process.env.CARTOGRAPH_DATA_DIR = path.join(tmp, "data");
process.env.CARTOGRAPH_BRAIN = "fixture";
process.env.CARTOGRAPH_FIXTURE_DELAY = "0";
process.env.GITHUB_WEBHOOK_SECRET = "hook-secret";
delete process.env.CARTOGRAPH_ALLOW_PRIVATE_CALLBACKS;
delete process.env.CARTOGRAPH_LOCAL_REPOS;

const { createApp } = await import("../src/server/app");

let server: http.Server;
let port = 0;

interface Res {
  status: number;
  body: string;
  json: () => any;
}

/** Raw HTTP (fetch forbids setting Host). `remote` mimics a request through the Cloudflare tunnel. */
function request(method: string, p: string, opts: { remote?: boolean; host?: string; origin?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Res> {
  const body = opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  const headers: Record<string, string> = {
    host: opts.host ?? (opts.remote ? "brave-test-tunnel.trycloudflare.com" : `localhost:${port}`),
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(opts.remote ? { "cf-ray": "test-ray", "cf-connecting-ip": "203.0.113.7" } : {}),
    ...(opts.origin ? { origin: opts.origin } : {}),
    ...(opts.headers ?? {}),
  };
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          body: data,
          json: () => JSON.parse(data.startsWith("event:") ? data.split("data: ")[1] : data),
        }),
      );
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const rpc = (method: string, params: Record<string, unknown> = {}) => ({ jsonrpc: "2.0", id: 1, method, params });
const initialize = rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } });

describe("security", () => {
  beforeAll(async () => {
    execFileSync("git", ["clone", "-q", path.resolve(__dirname, "../../chai-commerce"), localRepo]);
    server = createApp({ port: 0 }).listen(0);
    await new Promise((r) => server.once("listening", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => server?.close());

  it("serves bare routes to this machine", async () => {
    expect((await request("GET", "/health")).status).toBe(200);
  });

  it("hides every bare route from the tunnel", async () => {
    for (const p of ["/health", "/app", "/mcp"]) expect((await request("GET", p, { remote: true })).status).toBe(404);
    expect((await request("POST", "/api/tools/cartograph_repos", { remote: true, body: {} })).status).toBe(404);
    expect((await request("POST", "/mcp", { remote: true, body: initialize })).status).toBe(404);
  });

  it("serves the tunnel only under the secret prefix", async () => {
    expect((await request("GET", `/${TOKEN}/health`, { remote: true })).status).toBe(200);
    const r = await request("POST", `/${TOKEN}/mcp`, { remote: true, body: initialize, headers: { "mcp-protocol-version": "2025-11-25" } });
    expect(r.status).toBe(200);
    expect(r.json().result.serverInfo.name).toBe("cartograph");
    expect((await request("GET", `/${TOKEN.slice(0, -1)}x/health`, { remote: true })).status).toBe(404);
  });

  it("rejects unknown Host headers (DNS rebinding)", async () => {
    expect((await request("GET", "/health", { host: "evil.example" })).status).toBe(403);
  });

  it("blocks cross-site browser requests but allows localhost dev tools", async () => {
    expect((await request("POST", "/api/tools/cartograph_repos", { origin: "https://evil.example", body: {} })).status).toBe(403);
    expect((await request("POST", "/api/tools/cartograph_repos", { origin: "http://localhost:6274", body: {} })).status).toBe(200);
    expect((await request("POST", `/${TOKEN}/api/tools/cartograph_repos`, { remote: true, origin: "http://localhost:6274", body: {} })).status).toBe(403);
  });

  it("never lets a remote MCP client map a local folder", async () => {
    const remote = await request("POST", `/${TOKEN}/api/tools/map_repo`, { remote: true, body: { repo: localRepo } });
    expect(remote.status).toBe(400);
    expect(remote.json().error).toContain("GitHub");
    const viaMcp = await request("POST", `/${TOKEN}/mcp`, {
      remote: true,
      headers: { "mcp-protocol-version": "2025-11-25" },
      body: rpc("tools/call", { name: "map_repo", arguments: { repo: "/Users" } }),
    });
    expect(viaMcp.json().result.isError).toBe(true);
    expect(viaMcp.json().result.content[0].text).toContain("GitHub");
    // The owner, on this machine, can.
    expect((await request("POST", "/api/tools/map_repo", { body: { repo: localRepo } })).status).toBe(200);
  });

  it("refuses MCP Events callbacks into private networks", async () => {
    const sub = (url: string) =>
      request("POST", `/${TOKEN}/mcp`, {
        remote: true,
        headers: { "mcp-protocol-version": "2025-11-25" },
        body: rpc("events/subscribe", { name: "cartograph.architecture_drift", delivery: { mode: "webhook", url, secret: `whsec_${Buffer.alloc(24, 7).toString("base64")}` } }),
      });
    for (const url of ["https://127.0.0.1/hook", "https://192.168.1.1/admin", "https://[::1]/x", "http://example.com/hook"]) {
      const err = (await sub(url)).json().error;
      expect(err?.code, url).toBe(-32602);
    }
  });

  it("requires a valid signature on GitHub webhooks", async () => {
    const body = JSON.stringify({ zen: "hi" });
    expect((await request("POST", "/webhooks/github", { remote: true, body, headers: { "x-github-event": "ping" } })).status).toBe(401);
    const sig = `sha256=${createHmac("sha256", "hook-secret").update(body).digest("hex")}`;
    const ok = await request("POST", "/webhooks/github", { remote: true, body, headers: { "x-github-event": "ping", "x-hub-signature-256": sig } });
    expect(ok.status).toBe(200);
  });
});
