import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BudgetExceededError, checkBudget, readUsage, recordUsage, summarize, type UsageRecord } from "../src/llm/usage";

const rec = (ts: string, tokens = 100, ok = true): UsageRecord => ({
  ts, provider: "nvidia", model: "m", agent: "a", inputTokens: tokens, outputTokens: 0, ms: 1, ok,
});
const budget = { maxCallsPerDay: 3, maxTokensPerDay: 1000, maxCallsPerMinute: 2 };
const now = new Date("2026-10-22T10:00:00Z");

describe("usage ledger", () => {
  it("round-trips records through the JSONL file", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "usage-")), "u.jsonl");
    recordUsage(rec("2026-10-22T09:00:00Z"), file);
    recordUsage(rec("2026-10-22T09:01:00Z", 50, false), file);
    expect(readUsage(file)).toHaveLength(2);
    expect(summarize(readUsage(file))).toEqual([{ day: "2026-10-22", calls: 2, failed: 1, inputTokens: 150, outputTokens: 0 }]);
  });

  it("returns an empty ledger when the file does not exist", () => {
    expect(readUsage("/nonexistent/usage.jsonl")).toEqual([]);
  });
});

describe("checkBudget", () => {
  it("allows calls under every cap", () => {
    expect(checkBudget([rec("2026-10-22T08:00:00Z")], budget, now)).toBe(0);
  });

  it("ignores yesterday's usage", () => {
    const old = [rec("2026-10-21T10:00:00Z", 5000), rec("2026-10-21T10:00:01Z"), rec("2026-10-21T10:00:02Z")];
    expect(checkBudget(old, budget, now)).toBe(0);
  });

  it("stops at the daily call cap", () => {
    const r = ["08:00", "08:01", "08:02"].map((t) => rec(`2026-10-22T${t}:00Z`));
    expect(() => checkBudget(r, budget, now)).toThrow(BudgetExceededError);
  });

  it("stops at the daily token cap", () => {
    expect(() => checkBudget([rec("2026-10-22T08:00:00Z", 1000)], budget, now)).toThrow(/token cap/);
  });

  it("asks to wait when the per-minute cap is full", () => {
    const r = [rec("2026-10-22T09:59:30Z"), rec("2026-10-22T09:59:50Z")];
    expect(checkBudget(r, budget, now)).toBe(30_000);
  });
});
