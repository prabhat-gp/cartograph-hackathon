import { describe, expect, it } from "vitest";
import { autoDetect, normalizeBaseUrl, parseConnectLink, probeRuntime } from "../src/meterless/runtime";

describe("normalizeBaseUrl", () => {
  it.each([
    ["127.0.0.1:8088", "http://127.0.0.1:8088/v1"],
    ["http://127.0.0.1:8088", "http://127.0.0.1:8088/v1"],
    ["http://127.0.0.1:8088/v1", "http://127.0.0.1:8088/v1"],
    ["http://127.0.0.1:8088/v1/", "http://127.0.0.1:8088/v1"],
    ["http://127.0.0.1:8088/v1/chat/completions", "http://127.0.0.1:8088/v1"],
    ["http://127.0.0.1:8088/v1/models", "http://127.0.0.1:8088/v1"],
    ["http://127.0.0.1:8088/healthz", "http://127.0.0.1:8088/v1"],
    ["https://box.local:9000/v1/v1", "https://box.local:9000/v1"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected);
  });
});

describe("parseConnectLink", () => {
  it("reads a full link", () => {
    expect(parseConnectLink("http://192.168.1.5:8088/connect#k=abc")).toEqual({
      baseUrl: "http://192.168.1.5:8088/v1", apiKey: "abc", model: "meterless/auto", app: "cartograph",
    });
  });

  it("reads model and app, a trailing slash, https and an encoded key", () => {
    expect(parseConnectLink("https://h:1/connect/#k=a%2Bb&m=meterless/deep&n=other")).toEqual({
      baseUrl: "https://h:1/v1", apiKey: "a+b", model: "meterless/deep", app: "other",
    });
  });

  it("rejects anything that is not a connect link", () => {
    expect(parseConnectLink("http://127.0.0.1:8088/v1")).toBeNull();
    expect(parseConnectLink("http://127.0.0.1:8088/connect")).toBeNull();
    expect(parseConnectLink("http://127.0.0.1:8088/other#k=abc")).toBeNull();
    expect(parseConnectLink("not a url")).toBeNull();
  });
});

const reply = (status: number, body?: unknown) =>
  (async () => new Response(body === undefined ? "" : JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("probeRuntime", () => {
  const base = "http://127.0.0.1:8088/v1";

  it("is online with meterless modes", async () => {
    const h = await probeRuntime(base, "t", reply(200, { data: [{ id: "meterless/auto" }, { id: "meterless/deep" }, { id: "other" }] }));
    expect(h.state).toBe("online");
    expect(h.modes).toEqual(["meterless/auto", "meterless/deep"]);
  });

  it("is unauthorized, not offline, on a bad token", async () => {
    expect((await probeRuntime(base, "bad", reply(401))).state).toBe("unauthorized");
    expect((await probeRuntime(base, "bad", reply(403))).state).toBe("unauthorized");
  });

  it("is offline without meterless modes, on errors, and when unreachable", async () => {
    expect((await probeRuntime(base, "t", reply(200, { data: [{ id: "gpt" }] }))).state).toBe("offline");
    expect((await probeRuntime(base, "t", reply(500))).state).toBe("offline");
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect((await probeRuntime(base, "t", down)).state).toBe("offline");
  });

  it("auto-detects the first port that answers", async () => {
    const f = (async (url: string) =>
      url.startsWith("http://localhost:8090")
        ? new Response(JSON.stringify({ data: [{ id: "meterless/auto" }] }), { status: 200 })
        : Promise.reject(new TypeError("refused"))) as unknown as typeof fetch;
    expect((await autoDetect("t", f))?.baseUrl).toBe("http://localhost:8090/v1");
  });
});
