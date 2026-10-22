// One "why" investigation: Planner → Investigator → Writer ↔ Critic, with
// the Critic able to send the Investigator back for more evidence. Every
// step lands in the run's trace.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { checkCitations, critique, plan, write, type Draft, type EvidenceItem, type Plan, type Review } from "./agents";
import {
  discussion, fileHistory, linkedIssues, lineOrigins, listFiles, pullRequests, searchChanges, zetarisQuery, type Change, type Query,
} from "./evidence";
import { cloneDir } from "../ingest/git";
import { asEvidenceText, recall, remember } from "../memory/findings";
import { Trace } from "./trace";

export interface RunInput {
  repo: string;
  question: string;
  path?: string;
  line?: number;
}

export interface RunResult {
  run_id: string;
  status: "success" | "error";
  output?: {
    answer: string;
    claims: Draft["claims"];
    chain: EvidenceItem[];
    confidence: Draft["confidence"];
    unknowns: string[];
    evidence: EvidenceItem[];
    rounds: number;
    approved: boolean;
    plan: Plan;
    memory_ids: string[];
  };
  error?: { type: string; message: string; recoverable: boolean };
  agents: { name: string; role: string }[];
  trace_id: string;
  log_file: string;
  execution_time_seconds: number;
}

export const AGENTS = [
  { name: "Planner", role: "Turns the question into a target (file, lines or topic) and search terms" },
  { name: "Investigator", role: "Queries the provenance USL in Zetaris and gathers evidence" },
  { name: "Writer", role: "Drafts the answer and the evidence chain, citing every claim" },
  { name: "Critic", role: "Checks each claim against the evidence and sends the work back when it falls short" },
  { name: "Memory", role: "Meterless H-MEM: recalls verified findings, sets aside stale ones, remembers approved claims with provenance" },
];

const MAX_REVISIONS = 2;
const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/\r/g, "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

function codeSnippet(repo: string, file: string, from: number, to: number): string | null {
  const full = path.join(cloneDir(repo), file);
  if (!existsSync(full)) return null;
  const lines = readFileSync(full, "utf8").split("\n");
  return lines.slice(from - 1, to).map((l, i) => `${from + i}| ${l}`).join("\n");
}

/** Gathers evidence; later rounds add what the Critic asked for. */
class Investigator {
  readonly evidence: EvidenceItem[] = [];
  private seen = new Set<string>();
  private prIds = new Set<string>();

  constructor(private q: Query, private trace: Trace, private input: RunInput, private fileId: string | null) {}

  /** Commits that own the asked-about lines today (filled by the first round). */
  readonly currentShas: string[] = [];

  addMemory(items: Omit<EvidenceItem, "id">[]): void {
    for (const item of items) this.add(item);
  }

  private add(item: Omit<EvidenceItem, "id">): void {
    const key = `${item.kind}:${item.url ?? item.ref}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.evidence.push({ id: `E${this.evidence.length + 1}`, ...item });
  }

  private addChanges(changes: Change[]): void {
    for (const c of changes) {
      this.add({ kind: "commit", ref: c.sha.slice(0, 10), title: c.subject, text: clip(`${c.author_name}, ${c.authored_at.slice(0, 10)}\n${c.subject}\n${c.body ?? ""}`, 700), url: c.url });
      if (c.pr_id) this.prIds.add(c.pr_id);
    }
  }

  async round(p: Plan, ask: Review["need_more"] | null, retry: number): Promise<void> {
    const before = this.evidence.length;
    const queries: string[] = [];
    const from = Math.max(1, (p.line_start ?? 1) - (ask?.widen_lines ?? 0));
    const to = (p.line_end ?? p.line_start ?? 1) + (ask?.widen_lines ?? 0);

    if (this.fileId && p.line_start && (retry === 0 || (ask?.widen_lines ?? 0) > 0)) {
      const snippet = codeSnippet(this.input.repo, p.path!, from, to);
      if (snippet) this.add({ kind: "code", ref: `${p.path}:${from}-${to}`, title: `${p.path} lines ${from}-${to}`, text: snippet, url: null });
      const origins = await lineOrigins(this.q, this.fileId, from, to);
      queries.push("line_origin ⋈ code_change");
      for (const o of origins) if (!this.currentShas.includes(o.commit_sha)) this.currentShas.push(o.commit_sha);
      this.addChanges(origins.map((o) => ({ sha: o.commit_sha, subject: o.subject, body: o.body, author_name: o.author_name, authored_at: o.authored_at, url: o.commit_url, pr_id: o.pr_id })));
    }
    if (this.fileId && (p.intent === "file" || ask?.file_history || (retry === 0 && !p.line_start))) {
      this.addChanges(await fileHistory(this.q, this.fileId, 10));
      queries.push("file_change ⋈ code_change");
    }
    const keywords = retry === 0 ? (p.intent === "line" ? [] : p.keywords) : ask?.keywords ?? [];
    if (keywords.length) {
      this.addChanges(await searchChanges(this.q, this.input.repo, keywords));
      queries.push(`search ${keywords.join(", ")}`);
    }

    const prs = await pullRequests(this.q, [...this.prIds]);
    if (prs.length) queries.push("pull_request");
    for (const pr of prs) {
      this.add({ kind: "pull_request", ref: `#${pr.number}`, title: pr.title, text: clip(`by ${pr.author ?? "unknown"}, merged ${pr.merged_at?.slice(0, 10) ?? "?"}\n${pr.body ?? "(no description)"}`, 1200), url: pr.url });
    }
    const issues = await linkedIssues(this.q, prs.map((p) => p.id));
    if (issues.length) queries.push("pr_issue ⋈ issue");
    for (const i of issues) {
      this.add({ kind: "issue", ref: `#${i.number}`, title: i.title, text: clip(`${i.relation === "closes" ? "closed by" : "mentioned by"} ${i.pr_id.split("#")[1] ? `#${i.pr_id.split("#")[1]}` : i.pr_id}${i.labels ? `, labels: ${i.labels}` : ""}\n${i.body ?? ""}`, 1200), url: i.url });
    }
    const comments = await discussion(this.q, [...prs.map((p) => p.id), ...issues.map((i) => i.id)], this.input.path ?? p.path ?? undefined, 12);
    if (comments.length) queries.push("discussion");
    for (const c of comments) {
      this.add({ kind: "comment", ref: `${c.parent_id.split("#")[1] ? `#${c.parent_id.split("#")[1]}` : c.parent_id} ${c.kind}`, title: `${c.author ?? "someone"} on ${c.kind === "review_comment" && c.path ? `${c.path}:${c.line ?? "?"}` : c.parent_id.split("/").pop()}`, text: clip(c.body, 600), url: c.url });
    }

    this.trace.emit({
      agent_name: "Investigator", action: retry ? "investigate_more" : "investigate", target_agent: "Writer", retry_count: retry,
      input_summary: retry ? `Critic asked for ${JSON.stringify(ask)}` : `${p.intent} question on ${p.path ?? "the repository"}${p.line_start ? ` lines ${from}-${to}` : ""}`,
      output_summary: `${this.evidence.length - before} new evidence items (${this.evidence.length} total) from Zetaris USL`,
      status: "success", details: { zetaris_queries: queries },
    });
  }
}

export async function runWhy(input: RunInput, opts: { query?: Query; quiet?: boolean; useMemory?: boolean } = {}): Promise<RunResult> {
  const useMemory = opts.useMemory ?? true;
  const runId = randomUUID().slice(0, 8);
  const trace = new Trace(runId, undefined, opts.quiet);
  const started = performance.now();
  const q = opts.query ?? zetarisQuery;
  const done = (r: Omit<RunResult, "run_id" | "agents" | "trace_id" | "log_file" | "execution_time_seconds">): RunResult => ({
    run_id: runId, agents: AGENTS, trace_id: `trace-${runId}`, log_file: path.relative(process.cwd(), trace.file),
    execution_time_seconds: Math.round((performance.now() - started) / 100) / 10, ...r,
  });

  try {
    const files = await listFiles(q, input.repo);
    if (files.length === 0) throw Object.assign(new Error(`${input.repo} has not been ingested`), { type: "UnknownRepository" });

    // What Cartograph already remembers about this repository (H-MEM).
    const early = useMemory ? recall(input.repo, input.question, input.path ?? null, []) : null;
    if (early) {
      trace.emit({
        agent_name: "Memory", action: "recall", target_agent: "Planner", input_summary: input.question.slice(0, 160),
        output_summary: `${early.result.memories.length} remembered findings (${early.result.trace.strategy}): ${early.result.trace.retrievalReason}`,
        status: "success", details: { scores: early.result.trace.scores },
      });
    }
    const p = await plan({ question: input.question, repo: input.repo, paths: files.map((f) => f.path).slice(0, 600), path: input.path, line: input.line, memory: early?.result.context ?? "" });
    if (input.path) p.path = input.path;
    if (input.line) {
      p.line_start = input.line;
      p.line_end = Math.max(input.line, p.line_end ?? input.line);
      p.intent = "line";
    }
    const file = files.find((f) => f.path === p.path) ?? (p.path ? files.find((f) => f.path.endsWith(`/${p.path!.split("/").pop()}`)) : undefined);
    if (p.path && !file) p.path = null;
    if (file) p.path = file.path;
    trace.emit({
      agent_name: "Planner", action: "plan", target_agent: "Investigator",
      input_summary: input.question.slice(0, 160),
      output_summary: `${p.intent} on ${p.path ?? "(no file)"}${p.line_start ? `:${p.line_start}-${p.line_end}` : ""}; keywords ${p.keywords.join(", ") || "none"}`,
      status: "success", details: { plan: p },
    });

    const investigator = new Investigator(q, trace, input, file?.id ?? null);
    await investigator.round(p, null, 0);

    // Remembered findings join the evidence, unless the lines they explain have changed since.
    let stale: ReturnType<typeof recall>["stale"] = [];
    if (useMemory) {
      const r = recall(input.repo, input.question, p.path, investigator.currentShas);
      stale = r.stale;
      const fresh = r.result.memories.map((m) => m.memory).filter((m) => !m.supersededBy && !stale.includes(m));
      investigator.addMemory(fresh.map((m) => ({ kind: "memory", ref: m.id.slice(0, 12), title: `remembered finding (confidence ${m.confidence})`, text: asEvidenceText(m), url: null })));
      if (fresh.length || stale.length) {
        trace.emit({
          agent_name: "Memory", action: "contribute", target_agent: "Writer", input_summary: `${r.result.memories.length} recalled`,
          output_summary: `${fresh.length} findings added as evidence${stale.length ? `, ${stale.length} set aside as stale: the lines changed since` : ""}`,
          status: "success",
        });
      }
    }

    let draft = await write({ question: input.question, evidence: investigator.evidence });
    trace.emit({ agent_name: "Writer", action: "draft", target_agent: "Critic", input_summary: `${investigator.evidence.length} evidence items`, output_summary: `${draft.claims.length} claims, confidence ${draft.confidence}`, status: "success" });

    let approved = false;
    let rounds = 0;
    let memoryIds: string[] = [];
    for (; rounds <= MAX_REVISIONS; rounds++) {
      const mechanical = checkCitations(draft, investigator.evidence);
      const review = await critique({ question: input.question, draft, evidence: investigator.evidence });
      const problems = [...mechanical, ...review.problems.map((x) => `claim ${x.claim}: ${x.problem}`)];
      if (problems.length === 0 && review.verdict === "approve") {
        approved = true;
        trace.emit({ agent_name: "Critic", action: "approve", target_agent: "Writer", retry_count: rounds, input_summary: `${draft.claims.length} claims`, output_summary: "every claim is supported by its cited evidence", status: "success" });
        break;
      }
      const wantsMore = review.need_more.file_history || review.need_more.widen_lines > 0 || review.need_more.keywords.length > 0;
      trace.emit({
        agent_name: "Critic", action: "critique", target_agent: wantsMore ? "Investigator" : "Writer", retry_count: rounds,
        input_summary: `${draft.claims.length} claims`, output_summary: `${problems.length} problems: ${problems.join("; ").slice(0, 300)}`,
        status: "needs_revision", details: { problems, need_more: review.need_more },
      });
      if (rounds === MAX_REVISIONS) break;
      if (wantsMore) await investigator.round(p, review.need_more, rounds + 1);
      draft = await write({ question: input.question, evidence: investigator.evidence, feedback: problems.join("\n") });
      trace.emit({ agent_name: "Writer", action: "revise", target_agent: "Critic", retry_count: rounds + 1, input_summary: `${problems.length} problems, ${investigator.evidence.length} evidence items`, output_summary: `${draft.claims.length} claims, confidence ${draft.confidence}`, status: "success" });
    }

    if (approved && useMemory) {
      const saved = remember({ repo: input.repo, question: input.question, file: p.path, draft, evidence: investigator.evidence, runId, supersede: stale });
      trace.emit({
        agent_name: "Memory", action: "store", input_summary: `${draft.claims.length} approved claims`,
        output_summary: `${saved.length} findings remembered with provenance${saved.some((m) => m.supersedes) ? "; stale findings superseded" : ""}`,
        status: "success", details: { memory_ids: saved.map((m) => m.id) },
      });
      memoryIds = saved.map((m) => m.id);
    }

    // Unsupported citations never reach the user.
    const ids = new Map(investigator.evidence.map((e) => [e.id, e]));
    const claims = draft.claims.map((c) => ({ ...c, evidence: c.evidence.filter((id) => ids.has(id)) })).filter((c) => c.evidence.length);
    const result = done({
      status: "success",
      output: {
        answer: draft.answer, claims, chain: draft.chain.flatMap((id) => ids.get(id) ?? []), confidence: approved ? draft.confidence : "low",
        unknowns: approved ? draft.unknowns : [...draft.unknowns, "The Critic did not approve every claim within the revision limit."],
        evidence: investigator.evidence, rounds, approved, plan: p, memory_ids: memoryIds,
      },
    });
    trace.emit({ agent_name: "Writer", action: "final", input_summary: `approved=${approved}`, output_summary: `answer with ${claims.length} cited claims in ${result.execution_time_seconds}s`, status: "success" });
    return result;
  } catch (error) {
    const err = error as Error & { type?: string };
    trace.emit({ agent_name: "Orchestrator", action: "fail", input_summary: input.question.slice(0, 160), output_summary: err.message.slice(0, 300), status: "error" });
    return done({ status: "error", error: { type: err.type ?? err.name ?? "Error", message: err.message, recoverable: !/not been ingested/.test(err.message) } });
  }
}
