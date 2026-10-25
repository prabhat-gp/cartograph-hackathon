// Sample mode (SAMPLE_MODE=true): the examples in input_examples/ run through
// the real agent code with no keys and no network. Each one was recorded from
// a live run: what Zetaris returned for every query, what each model answered,
// and the source file the Investigator quoted. Replaying feeds those back in,
// so planning, evidence gathering, citation checks, the Critic's loop and
// H-MEM all run again for real. Every run, recorded or replayed, starts from
// its own empty memory, so each example stands alone.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { modelTap } from "../llm/client";
import { memoryRoot } from "../memory/findings";
import { cloneDir } from "../ingest/git";
import { zetarisQuery, type Query } from "./evidence";
import { runWhy, type RunInput, type RunResult } from "./run";

export const SAMPLE_MODE = process.env.SAMPLE_MODE === "true";

const ROOT = process.cwd();
export const INPUT_DIR = path.join(ROOT, "input_examples");
export const OUTPUT_DIR = path.join(ROOT, "output_examples");
const SAMPLE_DIR = path.join(ROOT, "samples");

export interface Example extends RunInput {
  id: string;
}

interface Recording {
  id: string;
  recorded_at: string;
  input: RunInput;
  /** The source files the Investigator quoted, by repository path. */
  files: Record<string, string>;
  queries: { sql: string; rows: Record<string, unknown>[] }[];
  replies: { agent: string; output: unknown }[];
}

export function listExamples(): Example[] {
  if (!existsSync(INPUT_DIR)) return [];
  return readdirSync(INPUT_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(INPUT_DIR, f), "utf8")) as Example);
}

/** Runs one example live against Zetaris and the models, and saves what they answered. */
export async function recordExample(example: Example): Promise<RunResult> {
  const { id, ...input } = example;
  const queries: Recording["queries"] = [];
  const replies: Recording["replies"] = [];
  const query: Query = async (sql) => {
    const rows = await zetarisQuery(sql);
    queries.push({ sql, rows });
    return rows;
  };
  const result = await memoryRoot.run(freshMemory(), () =>
    modelTap.run({ record: (agent, output) => replies.push({ agent, output }) }, () => runWhy(input, { query })),
  );
  if (result.status !== "success") throw new Error(`${id}: ${result.error?.message}`);

  const quoted = result.output!.plan.path;
  const files = quoted ? { [quoted]: readFileSync(path.join(input.dir ?? cloneDir(input.repo), quoted), "utf8") } : {};
  mkdirSync(SAMPLE_DIR, { recursive: true });
  const recording: Recording = { id, recorded_at: new Date().toISOString(), input, files, queries, replies };
  writeFileSync(path.join(SAMPLE_DIR, `${id}.json`), JSON.stringify(recording, null, 2) + "\n");
  return result;
}

/** Replays one example with no keys: same agents, recorded answers. */
export async function replayExample(id: string): Promise<RunResult> {
  const file = path.join(SAMPLE_DIR, `${id}.json`);
  if (!existsSync(file)) throw new Error(`no recorded sample "${id}"; examples: ${listExamples().map((e) => e.id).join(", ")}`);
  const rec = JSON.parse(readFileSync(file, "utf8")) as Recording;

  const dir = mkdtempSync(path.join(tmpdir(), "cartograph-sample-"));
  for (const [rel, text] of Object.entries(rec.files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  const answers = new Map(rec.queries.map((q) => [q.sql, q.rows]));
  const query: Query = async (sql) => {
    const rows = answers.get(sql);
    if (!rows) throw new Error(`sample "${id}" has no recorded Zetaris answer for: ${sql.slice(0, 200)}`);
    return rows;
  };
  const replies = [...rec.replies];
  const replay = (agent: string) => {
    const next = replies.shift();
    if (!next) throw new Error(`sample "${id}" ran out of recorded ${agent} answers`);
    if (next.agent !== agent) throw new Error(`sample "${id}" expected a ${next.agent} call, got ${agent}`);
    return next.output;
  };
  return memoryRoot.run(freshMemory(), () => modelTap.run({ replay }, () => runWhy({ ...rec.input, dir }, { query })));
}

const freshMemory = () => mkdtempSync(path.join(tmpdir(), "cartograph-sample-memory-"));

/** POST /run in sample mode: an example id, or the exact input of one. */
export function findExample(body: Partial<Example> & { example?: string }): Example | undefined {
  const examples = listExamples();
  const id = body.example ?? body.id;
  if (id) return examples.find((e) => e.id === id);
  return examples.find((e) => e.repo === body.repo && e.question === body.question);
}
