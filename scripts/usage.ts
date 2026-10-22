// Prints model usage per day and per model from the local ledger.
import { readUsage, summarize, usageFile } from "../src/llm/usage";

const records = readUsage();
if (records.length === 0) {
  console.log(`No usage recorded yet (${usageFile()}).`);
  process.exit(0);
}
console.table(summarize(records));

const byModel = new Map<string, { calls: number; failed: number; tokens: number; avgMs: number }>();
for (const r of records) {
  const m = byModel.get(r.model) ?? { calls: 0, failed: 0, tokens: 0, avgMs: 0 };
  m.avgMs = Math.round((m.avgMs * m.calls + r.ms) / (m.calls + 1));
  m.calls++;
  if (!r.ok) m.failed++;
  m.tokens += r.inputTokens + r.outputTokens;
  byModel.set(r.model, m);
}
console.table(Object.fromEntries(byModel));
