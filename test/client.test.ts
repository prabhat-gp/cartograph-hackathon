import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { callJson, extractJson, ModelOutputError } from "../src/llm/client";
import { readUsage } from "../src/llm/usage";

const schema = z.object({ module: z.string(), confidence: z.enum(["low", "medium", "high"]) });

function fakeFetch(replies: { content: string; finish?: string; status?: number }[]) {
  const bodies: Record<string, unknown>[] = [];
  const headers: Record<string, string>[] = [];
  const fn = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    headers.push(init.headers as Record<string, string>);
    const r = replies.shift()!;
    const payload = { choices: [{ message: { content: r.content }, finish_reason: r.finish ?? "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
    return new Response(r.status ? "upstream error" : JSON.stringify(payload), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, bodies, headers };
}

function deps(f: typeof fetch, name: "nvidia" | "meterless" = "nvidia") {
  const usagePath = path.join(mkdtempSync(path.join(tmpdir(), "client-")), "u.jsonl");
  return {
    usagePath,
    deps: {
      provider: { name, baseUrl: "http://x/v1", apiKey: "k" },
      fallback: null,
      budget: { maxCallsPerDay: 100, maxTokensPerDay: 1e6, maxCallsPerMinute: 100 },
      usagePath,
      fetch: f,
      sleep: async () => {},
    },
  };
}

const call = { agent: "test", instructions: "Classify.", input: "file", schema };

describe("extractJson", () => {
  it("reads plain and fenced JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});

describe("callJson", () => {
  it("returns validated output and logs usage", async () => {
    const f = fakeFetch([{ content: '{"module":"security","confidence":"high"}' }]);
    const d = deps(f.fn);
    await expect(callJson(call, d.deps)).resolves.toEqual({ module: "security", confidence: "high" });
    expect(f.bodies[0].response_format).toEqual({ type: "json_object" });
    expect(f.bodies[0].chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(readUsage(d.usagePath)).toMatchObject([{ agent: "test", ok: true, inputTokens: 10, outputTokens: 5 }]);
  });

  it("repairs a schema mismatch with the validation error", async () => {
    const f = fakeFetch([{ content: '{"module":"security","reasoning":"x"}' }, { content: '{"module":"security","confidence":"low"}' }]);
    const d = deps(f.fn);
    await expect(callJson(call, d.deps)).resolves.toEqual({ module: "security", confidence: "low" });
    const repair = f.bodies[1].messages as { role: string; content: string }[];
    expect(repair.at(-1)!.content).toMatch(/confidence/);
    expect(readUsage(d.usagePath).map((r) => r.ok)).toEqual([false, true]);
  });

  it("treats a max_tokens cut-off as a failed answer", async () => {
    const f = fakeFetch([{ content: '{"module": "x"\n \n \n', finish: "length" }, { content: '{"module":"x","confidence":"medium"}' }]);
    await expect(callJson(call, deps(f.fn).deps)).resolves.toMatchObject({ confidence: "medium" });
  });

  it("gives up after two bad answers", async () => {
    const f = fakeFetch([{ content: "nope" }, { content: "{}" }]);
    await expect(callJson(call, deps(f.fn).deps)).rejects.toThrow(ModelOutputError);
  });

  it("retries an HTTP error once", async () => {
    const f = fakeFetch([{ content: "", status: 500 }, { content: '{"module":"x","confidence":"high"}' }]);
    await expect(callJson(call, deps(f.fn).deps)).resolves.toMatchObject({ module: "x" });
  });

  it("does not retry a rejected request such as an unknown model", async () => {
    const f = fakeFetch([{ content: "", status: 404 }, { content: '{"module":"x","confidence":"high"}' }]);
    await expect(callJson(call, deps(f.fn).deps)).rejects.toThrow(/404/);
    expect(f.bodies).toHaveLength(1);
  });

  it("sends Meterless app headers only to Meterless", async () => {
    const f = fakeFetch([{ content: '{"module":"x","confidence":"high"}' }]);
    await callJson(call, deps(f.fn, "meterless").deps);
    expect(f.headers[0]).toMatchObject({ "meterless-app": "cartograph", "meterless-scope": "user" });
    const g = fakeFetch([{ content: '{"module":"x","confidence":"high"}' }]);
    await callJson(call, deps(g.fn).deps);
    expect(g.headers[0]["meterless-app"]).toBeUndefined();
  });
});

describe("callJson providers", () => {
  it("falls back to NVIDIA only when the runtime is unreachable", async () => {
    const urls: string[] = [];
    const f = (async (url: string, init: RequestInit) => {
      urls.push(url);
      if (url.startsWith("http://runtime")) throw new TypeError("fetch failed");
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe("nvidia/nemotron-3-ultra-550b-a55b");
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"module":"x","confidence":"high"}' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const d = deps(f, "meterless");
    const out = await callJson({ ...call, tier: "deep" }, {
      ...d.deps,
      provider: { name: "meterless", baseUrl: "http://runtime/v1", apiKey: "t" },
      fallback: { name: "nvidia", baseUrl: "http://nvidia/v1", apiKey: "n" },
    });
    expect(out.module).toBe("x");
    expect(urls).toEqual(["http://runtime/v1/chat/completions", "http://nvidia/v1/chat/completions"]);
    expect(readUsage(d.usagePath).map((r) => [r.provider, r.ok])).toEqual([["meterless", false], ["nvidia", true]]);
  });

  it("does not fall back when the runtime answered with an error", async () => {
    const f = fakeFetch([{ content: "", status: 401 }]);
    await expect(callJson(call, { ...deps(f.fn, "meterless").deps, fallback: { name: "nvidia", baseUrl: "http://n/v1", apiKey: "n" } })).rejects.toThrow(/401/);
    expect(f.bodies).toHaveLength(1);
  });

  it("uses meterless modes and no NVIDIA-only fields on the runtime", async () => {
    const f = fakeFetch([{ content: '{"module":"x","confidence":"high"}' }]);
    await callJson({ ...call, tier: "deep" }, deps(f.fn, "meterless").deps);
    expect(f.bodies[0].model).toBe("meterless/deep");
    expect(f.bodies[0].chat_template_kwargs).toBeUndefined();
  });

  it("backs off on 429 before counting it as a failure", async () => {
    const waits: number[] = [];
    const f = fakeFetch([{ content: "", status: 429 }, { content: '{"module":"x","confidence":"high"}' }]);
    const d = deps(f.fn);
    await callJson(call, { ...d.deps, sleep: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([2000]);
    expect(readUsage(d.usagePath)).toHaveLength(1);
  });
});
