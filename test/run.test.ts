import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Draft, Review } from "../src/agent/agents";

const { drafts, reviews } = vi.hoisted(() => ({ drafts: [] as Draft[], reviews: [] as Review[] }));
vi.mock("../src/agent/agents", async (orig) => ({
  ...(await orig<typeof import("../src/agent/agents")>()),
  plan: vi.fn(async () => ({ intent: "line", path: "src/a.ts", line_start: 2, line_end: 2, keywords: ["retry"], sub_questions: [] })),
  write: vi.fn(async () => drafts.shift()!),
  critique: vi.fn(async () => reviews.shift()!),
}));

const { runWhy } = await import("../src/agent/run");

/** A fake USL: answers by which table the SQL reads. */
const sqlSeen: string[] = [];
const query = async (sql: string) => {
  sqlSeen.push(sql);
  if (sql.includes("FROM lightning.metastore.cartograph.provenance.source_file")) return [{ id: "o/r:src/a.ts", path: "src/a.ts", lines: 10, language: "TypeScript" }];
  if (sql.includes("provenance.line_origin lo JOIN")) return [{ file_id: "o/r:src/a.ts", line_start: 1, line_end: 3, commit_sha: "c".repeat(40), subject: "Limit retries (#5)", body: null, author_name: "Ada", authored_at: "2026-01-01", commit_url: "u/c", pr_id: "o/r#5" }];
  if (sql.includes("provenance.file_change fc")) return [{ sha: "d".repeat(40), subject: "Add retries", body: null, author_name: "Bo", authored_at: "2025-12-01", url: "u/d", pr_id: null }];
  if (sql.includes("FROM lightning.metastore.cartograph.provenance.pull_request WHERE id IN")) return [{ id: "o/r#5", number: 5, title: "Limit retries", body: "Retries hammered the API", author: "ada", merged_at: "2026-01-01", url: "u/pr5", issue_count: 1, discussion_count: 0 }];
  if (sql.includes("provenance.pr_issue l JOIN")) return [{ id: "o/r#4", number: 4, title: "API rate limited by retries", body: "We get 429s", labels: "bug", state: "CLOSED", url: "u/i4", pr_id: "o/r#5", relation: "closes" }];
  return [];
};

const good: Draft = { answer: "Retries were capped after the API got rate limited.", claims: [{ text: "Retries in src/a.ts were capped in #5", evidence: ["E3"] }, { text: "The cap fixed API rate limiting reported in #4", evidence: ["E4"] }], chain: ["E1", "E2", "E3", "E4"], confidence: "high", unknowns: [] };
const approve: Review = { verdict: "approve", problems: [], need_more: { file_history: false, widen_lines: 0, keywords: [] } };

describe("runWhy", () => {
  beforeEach(() => {
    process.env.CARTOGRAPH_LOG_DIR = mkdtempSync(path.join(tmpdir(), "logs-"));
    process.env.CARTOGRAPH_REPOS_DIR = mkdtempSync(path.join(tmpdir(), "repos-"));
    process.env.CARTOGRAPH_MEMORY_DIR = mkdtempSync(path.join(tmpdir(), "memory-"));
    mkdirSync(path.join(process.env.CARTOGRAPH_REPOS_DIR, "o__r", "src"), { recursive: true });
    writeFileSync(path.join(process.env.CARTOGRAPH_REPOS_DIR, "o__r", "src", "a.ts"), "let tries = 0;\nconst MAX_RETRIES = 3;\nexport {};\n");
    sqlSeen.length = 0;
  });

  it("walks line → commit → pull request → issue and returns the chain", async () => {
    drafts.push(good);
    reviews.push(approve);
    const r = await runWhy({ repo: "o/r", question: "Why are retries capped?", path: "src/a.ts", line: 2 }, { query, quiet: true });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe("success");
    expect(r.output!.chain.map((e) => e.kind)).toEqual(["code", "commit", "pull_request", "issue"]);
    expect(r.output!.approved).toBe(true);
    const trace = readFileSync(path.resolve(r.log_file), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(trace.map((t) => `${t.agent_name}:${t.action}`)).toEqual(["Memory:recall", "Planner:plan", "Investigator:investigate", "Writer:draft", "Critic:approve", "Memory:store", "Writer:final"]);
  });

  it("sends the Investigator back when the Critic asks for file history, then revises", async () => {
    drafts.push({ ...good, claims: [{ text: "Bo added retries", evidence: ["E9"] }] }, good);
    reviews.push({ verdict: "revise", problems: [{ claim: 0, problem: "cites nothing real" }], need_more: { file_history: true, widen_lines: 0, keywords: [] } }, approve);
    const r = await runWhy({ repo: "o/r", question: "Why are retries capped?", path: "src/a.ts", line: 2 }, { query, quiet: true });
    expect(r.output!.rounds).toBe(1);
    expect(r.output!.evidence.some((e) => e.kind === "commit" && e.title === "Add retries")).toBe(true);
    const trace = readFileSync(path.resolve(r.log_file), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const critique = trace.find((t) => t.action === "critique");
    expect(critique.target_agent).toBe("Investigator");
    expect(critique.details.problems[0]).toMatch(/E9/);
    expect(trace.some((t) => t.action === "investigate_more")).toBe(true);
  });

  it("drops citations to evidence that doesn't exist and lowers confidence when never approved", async () => {
    const bad: Draft = { ...good, claims: [{ text: "made up", evidence: ["E42"] }, { text: "real", evidence: ["E3"] }] };
    drafts.push(bad, bad, bad);
    const revise: Review = { verdict: "revise", problems: [], need_more: { file_history: false, widen_lines: 0, keywords: [] } };
    reviews.push(revise, revise, revise);
    const r = await runWhy({ repo: "o/r", question: "Why?", path: "src/a.ts", line: 2 }, { query, quiet: true });
    expect(r.output!.approved).toBe(false);
    expect(r.output!.confidence).toBe("low");
    expect(r.output!.claims.map((c) => c.text)).toEqual(["real"]);
  });

  it("remembers approved findings and brings them back as evidence next time", async () => {
    drafts.push(good, good);
    reviews.push(approve, approve);
    const first = await runWhy({ repo: "o/r", question: "Why are retries capped?", path: "src/a.ts", line: 2 }, { query, quiet: true });
    expect(first.output!.memory_ids).toHaveLength(2);
    const second = await runWhy({ repo: "o/r", question: "Why is MAX_RETRIES 3 in src/a.ts?", path: "src/a.ts", line: 2 }, { query, quiet: true });
    expect(second.output!.evidence.some((e) => e.kind === "memory")).toBe(true);
    const { memoryFor } = await import("../src/memory/findings");
    const ledger = memoryFor("o/r").ledger.stats();
    expect(ledger.create).toBeGreaterThanOrEqual(2);
    expect(ledger.read).toBeGreaterThanOrEqual(1);
  });

  it("returns a structured error for a repository that was never ingested", async () => {
    const r = await runWhy({ repo: "x/y", question: "Why?" }, { query: async () => [], quiet: true });
    expect(r.status).toBe("error");
    expect(r.error).toMatchObject({ type: "UnknownRepository", recoverable: false });
  });

  it("escapes values in every query it sends", async () => {
    drafts.push(good);
    reviews.push(approve);
    await runWhy({ repo: "o/r", question: "Why?", path: "src/a.ts", line: 2 }, { query, quiet: true });
    const { lit } = await import("../src/agent/evidence");
    expect(lit("it's")).toBe("'it''s'");
    expect(lit("a\\' OR 1=1")).toBe("'a\\\\'' OR 1=1'");
  });
});
