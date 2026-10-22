// Usage ledger and budget guard. Every model call is appended to a JSONL file
// so we can see what the free NVIDIA quota is being spent on, and calls stop
// before a daily cap is crossed (keeps quota for judging week).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface UsageRecord {
  ts: string;
  provider: string;
  model: string;
  agent: string;
  inputTokens: number;
  outputTokens: number;
  ms: number;
  ok: boolean;
  error?: string;
}

export interface Budget {
  maxCallsPerDay: number;
  maxTokensPerDay: number;
  maxCallsPerMinute: number;
}

export class BudgetExceededError extends Error {
  override name = "BudgetExceededError";
}

export function usageFile(env: NodeJS.ProcessEnv = process.env): string {
  return env.CARTOGRAPH_USAGE_FILE ?? path.join(process.cwd(), ".cartograph", "usage.jsonl");
}

export function budgetFromEnv(env: NodeJS.ProcessEnv = process.env): Budget {
  const num = (name: string, fallback: number) => {
    const v = Number(env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    maxCallsPerDay: num("CARTOGRAPH_MAX_CALLS_PER_DAY", 1000),
    maxTokensPerDay: num("CARTOGRAPH_MAX_TOKENS_PER_DAY", 3_000_000),
    maxCallsPerMinute: num("CARTOGRAPH_MAX_CALLS_PER_MINUTE", 30),
  };
}

export function readUsage(file = usageFile()): UsageRecord[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as UsageRecord];
      } catch {
        return [];
      }
    });
}

export function recordUsage(record: UsageRecord, file = usageFile()): void {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(record) + "\n");
}

export interface DaySummary {
  day: string;
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
}

/** Totals per UTC day, oldest first. */
export function summarize(records: UsageRecord[]): DaySummary[] {
  const days = new Map<string, DaySummary>();
  for (const r of records) {
    const day = r.ts.slice(0, 10);
    const s = days.get(day) ?? { day, calls: 0, failed: 0, inputTokens: 0, outputTokens: 0 };
    s.calls++;
    if (!r.ok) s.failed++;
    s.inputTokens += r.inputTokens;
    s.outputTokens += r.outputTokens;
    days.set(day, s);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Throws if one more call would break today's caps; returns ms to wait for the per-minute cap. */
export function checkBudget(records: UsageRecord[], budget: Budget, now = new Date()): number {
  const today = now.toISOString().slice(0, 10);
  const todays = records.filter((r) => r.ts.startsWith(today));
  if (todays.length >= budget.maxCallsPerDay) {
    throw new BudgetExceededError(`Daily call cap reached (${budget.maxCallsPerDay}). Raise CARTOGRAPH_MAX_CALLS_PER_DAY to continue.`);
  }
  const tokens = todays.reduce((n, r) => n + r.inputTokens + r.outputTokens, 0);
  if (tokens >= budget.maxTokensPerDay) {
    throw new BudgetExceededError(`Daily token cap reached (${tokens} of ${budget.maxTokensPerDay}). Raise CARTOGRAPH_MAX_TOKENS_PER_DAY to continue.`);
  }
  const windowStart = now.getTime() - 60_000;
  const recent = todays.map((r) => Date.parse(r.ts)).filter((t) => t > windowStart).sort((a, b) => a - b);
  if (recent.length < budget.maxCallsPerMinute) return 0;
  return recent[recent.length - budget.maxCallsPerMinute] + 60_000 - now.getTime();
}
