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
