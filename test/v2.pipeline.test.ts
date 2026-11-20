// V2 end to end with a fake model: analysis → tree edits → gate → stories →
// review → export, plus the HTTP API against a real git repository.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Asker } from "../src/v2/agents/run";

const tmp = mkdtempSync(path.join(os.tmpdir(), "cartograph-v2-"));
process.env.CARTOGRAPH_DATA_DIR = path.join(tmp, "data");
delete process.env.CARTOGRAPH_PUBLIC;

const { buildInventory } = await import("../src/v2/inventory");
const { analyze } = await import("../src/v2/agents/analyze");
const { writeStories } = await import("../src/v2/agents/stories");
const { coverage } = await import("../src/v2/project");
const { applyBacklogOp, applyTreeOp, approveTree, exportBacklog, ReviewError } = await import("../src/v2/review");
type Project = import("../src/v2/project").Project;

const FIXTURE = path.join(__dirname, "fixtures", "v2", "accelerator");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
const files = walk(FIXTURE).map((p) => ({ path: path.relative(FIXTURE, p), content: readFileSync(p, "utf8") }));
const inv = buildInventory("acme/store", "abc1234", files);

const refsIn = (input: string, prefix: "e" | "x") => [...new Set([...input.matchAll(new RegExp(`\\b${prefix}\\d+\\b`, "g"))].map((m) => m[0]))];

/** A model that answers every agent sensibly from the refs in its input. */
function fakeModel(opts: { failCartographer?: boolean; bogusCitation?: boolean; skipEntry?: boolean } = {}): Asker & { calls: string[] } {
  const calls: string[] = [];
  const ask = (async (call) => {
    calls.push(call.label);
    switch (call.agent) {
      case "scout":
        return { summary: "A B2C storefront.", actors: ["Shopper", "System"], domains: [{ id: "cart", name: "Cart & checkout", description: "Cart, vouchers." }, { id: "ops", name: "Back-office jobs", description: "Jobs, processes and events." }] };
      case "reader": {
        const entries = refsIn(call.input.split("\n\n").slice(1).join("\n\n"), "e").filter((r) => call.input.includes(`ENTRY ${r}\n`));
        return { entries: entries.map((ref) => {
          const block = call.input.slice(call.input.indexOf(`ENTRY ${ref}\n`)).split("\nENTRY ")[0];
          const back = /cronjob|business-process|event-listener/.test(block.split("\n")[1] ?? "");
          return { ref, title: `Do ${ref}`, summary: `Summary of ${ref}`, actor: back ? "System" : "Shopper", domain: back ? "ops" : "cart" };
        }) };
      }
      case "cartographer": {
        if (opts.failCartographer) throw new Error("provider down");
        const refs = refsIn(call.input, "e");
        return { features: [{ id: null, name: call.input.includes("Back-office") ? "Housekeeping" : "Vouchers and cart", description: "d", refs }] };
      }
      case "reviewer":
        return { notes: [{ feature: "f1", severity: "info", message: "Looks fine." }] };
      case "story-writer": {
        const entries = [...call.input.matchAll(/^ENTRY (e\d+):/gm)].map((m) => m[1]);
        const xs = refsIn(call.input, "x");
        const only = call.input.includes("Write stories ONLY") ? refsIn(call.input.split("Write stories ONLY")[1], "e") : entries;
        const covered = opts.skipEntry && !call.input.includes("Write stories ONLY") ? only.slice(0, -1) : only;
        return {
          epic: { title: "Cart epic", description: "Everything about the cart." },
          stories: covered.map((e, i) => ({
            ref: `s${i + 1}`, title: `Story for ${e}`, userStory: "As a shopper, I want x, so that y.", technical: `Change ${xs[0]}`,
            acceptance: ["a", "b", "c"], elements: [xs[i % xs.length], ...(opts.bogusCitation ? ["x999"] : [])], entries: [e], dependsOn: i ? ["s1"] : [], size: "M",
          })),
        };
      }
    }
  }) as Asker & { calls: string[] };
  ask.calls = calls;
  return ask;
}

function emptyProject(): Project {
  return { version: 1, key: "acme__store", repo: { key: "acme__store", source: "github", name: "acme/store", location: "x" }, sha: inv.sha, scannedAt: new Date().toISOString(), stack: inv.stack, summary: "", entries: {}, domains: [], notes: [], epics: [], settings: { mode: "as-is", target: "" }, history: [] };
}

describe("analysis", () => {
  it("places every entry point, with agent titles and domains", async () => {
    const p = emptyProject();
    const r = await analyze(inv, p, new Map(), { ask: fakeModel() });
    Object.assign(p, { entries: r.entries, domains: r.domains, notes: r.notes });
    expect(coverage(p, inv).complete).toBe(true);
    expect(r.domains.map((d) => d.name).sort()).toEqual(["Back-office jobs", "Cart & checkout"]);
    expect(Object.values(r.entries).every((e) => e.by === "agent")).toBe(true);
    expect(r.notes.some((n) => n.message === "Looks fine.")).toBe(true);
  });

  it("fills in by rule when an agent fails, so nothing is left out", async () => {
    const p = emptyProject();
    const r = await analyze(inv, p, new Map(), { ask: fakeModel({ failCartographer: true }) });
    Object.assign(p, { domains: r.domains });
    expect(coverage(p, inv).complete).toBe(true);
    expect(r.domains.flatMap((d) => d.features).every((f) => f.by === "rule")).toBe(true);
  });

  it("works with no model at all", async () => {
    const p = emptyProject();
    const r = await analyze(inv, p, new Map(), { ask: async () => { throw new Error("no key"); } });
    Object.assign(p, { domains: r.domains });
    expect(coverage(p, inv).complete).toBe(true);
    expect(Object.values(r.entries).every((e) => e.by === "rule" && e.title)).toBe(true);
  });
});

describe("tree review and the gate", () => {
  it("won't approve until every entry point is placed, and reopens on edits", async () => {
    const p = emptyProject();
    Object.assign(p, await analyze(inv, p, new Map(), { ask: fakeModel() }));
    const f = p.domains[0].features[0];
    applyTreeOp(p, inv, { op: "unassign-entries", entryIds: [f.entryIds[0]] });
    expect(() => approveTree(p, inv)).toThrow(ReviewError);
    applyTreeOp(p, inv, { op: "new-feature", domainId: p.domains[0].id, name: "Orphans", entryIds: coverage(p, inv).unassigned });
    approveTree(p, inv);
    expect(p.approval?.sha).toBe(inv.sha);
    applyTreeOp(p, inv, { op: "rename-feature", featureId: f.id, name: "Renamed" });
    expect(p.approval).toBeUndefined();
    expect(p.history.map((h) => h.action)).toContain("gate reopened");
  });

  it("rejects ids that aren't entry points", async () => {
    const p = emptyProject();
    Object.assign(p, await analyze(inv, p, new Map(), { ask: fakeModel() }));
    expect(() => applyTreeOp(p, inv, { op: "move-entries", entryIds: ["java:made.Up#x"], toFeatureId: p.domains[0].features[0].id })).toThrow(/not entry points/);
  });

  it("merges and splits features", async () => {
    const p = emptyProject();
    Object.assign(p, await analyze(inv, p, new Map(), { ask: fakeModel() }));
    const all = p.domains.flatMap((d) => d.features);
    applyTreeOp(p, inv, { op: "merge-features", featureIds: all.map((f) => f.id), intoId: all[0].id });
    expect(p.domains.flatMap((d) => d.features)).toHaveLength(1);
    applyTreeOp(p, inv, { op: "split-feature", featureId: all[0].id, name: "Split", entryIds: all[0].entryIds.slice(0, 2) });
    expect(p.domains.flatMap((d) => d.features)).toHaveLength(2);
    expect(coverage(p, inv).complete).toBe(true);
  });
});

describe("stories", () => {
  const setup = async () => {
    const p = emptyProject();
    Object.assign(p, await analyze(inv, p, new Map(), { ask: fakeModel() }));
    approveTree(p, inv);
    const d = p.domains.find((x) => x.name === "Cart & checkout")!;
    return { p, d, f: d.features[0] };
  };

  it("drops citations to code that doesn't exist, and keeps the rest", async () => {
    const { p, d, f } = await setup();
    const { epic } = await writeStories({ inv, project: p, domain: d, feature: f, excerpts: new Map(), mode: "migrate", target: "Next.js + OCC" }, { ask: fakeModel({ bogusCitation: true }) });
    expect(epic.stories.length).toBe(f.entryIds.length);
    expect(epic.stories.every((s) => s.elements.every((id) => inv.elements.some((e) => e.id === id)))).toBe(true);
    expect(epic.stories[0].notes?.[0]).toMatch(/doesn't exist removed/);
    expect(epic.target).toBe("Next.js + OCC");
    expect(epic.stories[1].dependsOn).toEqual([epic.stories[0].id]);
  });

  it("asks again for entry points no story covers", async () => {
    const { p, d, f } = await setup();
    const ask = fakeModel({ skipEntry: true });
    const { epic } = await writeStories({ inv, project: p, domain: d, feature: f, excerpts: new Map(), mode: "as-is" }, { ask });
    expect(new Set(ask.calls.filter((c) => c.startsWith("story-writer")))).toHaveLength(2); // first answer + one repair (each asks two tiers)
    expect(new Set(epic.stories.flatMap((s) => s.entries))).toEqual(new Set(f.entryIds));
  });

  it("writes rule stories when the model is down, flagged for rewriting", async () => {
    const { p, d, f } = await setup();
    const { epic } = await writeStories({ inv, project: p, domain: d, feature: f, excerpts: new Map(), mode: "as-is" }, { ask: async () => { throw new Error("down"); } });
    expect(epic.by).toBe("rule");
    expect(epic.stories.every((s) => s.by === "rule" && s.elements.length > 0)).toBe(true);
  });

  it("exports only approved work as a Jira CSV and Markdown", async () => {
    const { p, d, f } = await setup();
    const { epic } = await writeStories({ inv, project: p, domain: d, feature: f, excerpts: new Map(), mode: "as-is" }, { ask: fakeModel() });
    p.epics.push(epic);
    expect(exportBacklog(p, inv, "csv").trim().split("\r\n")).toHaveLength(1);
    applyBacklogOp(p, { op: "set-story", epicId: epic.id, storyId: epic.stories[0].id, status: "approved" });
    applyBacklogOp(p, { op: "set-epic", epicId: epic.id, status: "approved" });
    const csv = exportBacklog(p, inv, "csv");
    const rows = csv.trim().split("\r\n");
    expect(rows[0]).toBe("Issue Id,Parent Id,Issue Type,Summary,Description,Labels,Story Points");
    expect(rows[1]).toMatch(/^1,,Epic,Cart epic,/);
    expect(csv).toMatch(/\r\n2,1,Story,Story for e1,"As a shopper/);
    expect(csv).toContain("CartPageController.java:");
    const md = exportBacklog(p, inv, "md");
    expect(md).toContain("## Epic: Cart epic");
    expect(md).toContain("**Acceptance criteria**");
    applyBacklogOp(p, { op: "approve-all", epicId: epic.id });
    expect(epic.stories.every((s) => s.status === "approved")).toBe(true);
  });
});

describe("HTTP API", () => {
  let base = "";
  let close: () => void = () => undefined;
  const repoDir = path.join(tmp, "acme-repo");
  beforeAll(async () => {
    cpSync(FIXTURE, repoDir, { recursive: true });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repoDir, stdio: "pipe" });
    git("init", "-q");
    git("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    const { setAsker } = await import("../src/v2/jobs");
    setAsker(fakeModel());
    const { createApp } = await import("../src/server/app");
    const server = createApp({ port: 0 }).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => {
    close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const call = async (method: string, p: string, body?: unknown) => {
    const res = await fetch(base + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, body: res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text };
  };
  const wait = async (jobId: string) => {
    for (let i = 0; i < 200; i++) {
      const { body } = await call("GET", `/api/v2/jobs/${jobId}`);
      if (body.status !== "running") return body;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("job timed out");
  };

  it("scans, analyzes, gates, writes stories and exports", async () => {
    const scan = await call("POST", "/api/v2/scan", { repo: repoDir });
    expect(scan.status).toBe(202);
    expect((await wait(scan.body.jobId)).status).toBe("done");
    const key = scan.body.key;
    let proj = await call("GET", `/api/v2/projects/${key}`);
    expect(proj.body.summary.stats.entryPoints).toBe(5);
    expect(proj.body.coverage.complete).toBe(false);

    const els = await call("GET", `/api/v2/projects/${key}/elements?kind=endpoint`);
    expect(els.body.total).toBe(2);
    const one = await call("GET", `/api/v2/projects/${key}/elements/${encodeURIComponent("java:com.acme.storefront.controllers.pages.CartPageController#applyVoucher")}`);
    expect(one.body.code).toContain("voucherFacade.applyVoucher(code);");
    expect(one.body.slice.length).toBeGreaterThan(3);

    expect((await call("POST", `/api/v2/projects/${key}/stories`, { all: true })).status).toBe(400);
    const an = await call("POST", `/api/v2/projects/${key}/analyze`, {});
    expect((await wait(an.body.jobId)).status).toBe("done");
    proj = await call("GET", `/api/v2/projects/${key}`);
    expect(proj.body.coverage.complete).toBe(true);
    expect((await call("POST", `/api/v2/projects/${key}/tree`, { op: "bogus" })).status).toBe(400);
    expect((await call("POST", `/api/v2/projects/${key}/approve`)).status).toBe(200);

    const st = await call("POST", `/api/v2/projects/${key}/stories`, { all: true, mode: "migrate", target: "Next.js" });
    expect(st.status).toBe(202);
    expect((await wait(st.body.jobId)).status).toBe("done");
    proj = await call("GET", `/api/v2/projects/${key}`);
    const epics = proj.body.project.epics;
    expect(epics.length).toBe(proj.body.summary.features);
    for (const e of epics) await call("POST", `/api/v2/projects/${key}/backlog`, { op: "approve-all", epicId: e.id });
    const csv = await call("GET", `/api/v2/projects/${key}/export.csv`);
    expect(csv.status).toBe(200);
    expect(String(csv.body).split("\r\n").filter((l: string) => /^\d+,\d*,(Epic|Story),/.test(l)).length).toBeGreaterThanOrEqual(epics.length + 5);
  });

  it("refuses scans of local folders from remote callers", async () => {
    const res = await fetch(`${base}/api/v2/scan`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" }, body: JSON.stringify({ repo: repoDir }) });
    expect(res.status).toBe(404); // bare routes are local-only unless the server is public
  });
});
