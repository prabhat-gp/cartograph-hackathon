// "Why is this here?" for a dependency on the map, and the why-coverage
// overlay. Both read the repository's history (commits, pull requests and
// issues) through the explain agents and the provenance layer in Zetaris.
import { ArrowUpRight, Brain, ChevronDown, CircleHelp, Eye, EyeOff, Minus, ShieldCheck, ThumbsDown, ThumbsUp, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { CartographGraph } from "../../shared/graph";
import type { ToolResult } from "./bridge";
import { Panel, PanelHead } from "./panels";
import { Button, CodeCite, Eyebrow, KindTag, KindTile, Spinner, cn } from "./ui";

// ---------------------------------------------------------------- types (server shapes)

export type CoverageStatus = "explained" | "reviewed" | "unreviewed" | "unknown";

export interface WhyCoverage {
  history: string;
  github: string | null;
  edges: Record<string, { status: CoverageStatus; pr: number | null; subject: string | null }>;
  counts: Record<CoverageStatus, number>;
}

interface EvidenceItem {
  id: string;
  kind: "code" | "commit" | "pull_request" | "issue" | "comment" | "memory";
  title: string;
  text: string;
  url: string | null;
  ref: string;
}

interface WhyResult {
  run_id: string;
  execution_time_seconds: number;
  /** Reused from an earlier approved run on the same commit. */
  cached?: boolean;
  output: {
    answer: string;
    claims: { text: string; evidence: string[] }[];
    chain: EvidenceItem[];
    confidence: "low" | "medium" | "high";
    unknowns: string[];
    evidence: EvidenceItem[];
    rounds: number;
    approved: boolean;
    memory_ids: string[];
  };
  trace: { agent_name: string; action: string; output_summary: string; status: string; target_agent?: string }[];
}

type CallTool = <T>(name: string, args: Record<string, unknown>) => Promise<ToolResult<T>>;

const COVERAGE_COPY: Record<CoverageStatus, { label: string; tone: string; text: string }> = {
  explained: { label: "Reason stated", tone: "bg-ok", text: "The cited line traces to a pull request that says why." },
  reviewed: { label: "Reviewed, no reason", tone: "bg-warn", text: "It went through a pull request, but nobody wrote down why." },
  unreviewed: { label: "No review trail", tone: "bg-danger", text: "Committed without a pull request: no review, no stated reason." },
  unknown: { label: "Not traced", tone: "bg-faint", text: "Cartograph couldn't trace this line's history." },
};

const KIND_LABEL: Record<EvidenceItem["kind"], string> = {
  code: "Code",
  commit: "Commit",
  pull_request: "Pull request",
  issue: "Issue",
  comment: "Discussion",
  memory: "Memory",
};

// The work happens in stages; show which one is likely running, honestly framed.
const STAGES = [
  { after: 0, text: "Reading the repository's history (first time only)…" },
  { after: 4, text: "Planner is targeting the cited line…" },
  { after: 9, text: "Investigator is following line → commit → pull request → issue in Zetaris…" },
  { after: 18, text: "Writer is drafting the answer; the Critic checks every claim against the evidence…" },
  { after: 45, text: "The Critic sent the work back for more evidence; revising…" },
];

// ---------------------------------------------------------------- dependency panel

export function DependencyPanel(props: {
  graph: CartographGraph;
  edgeId: string;
  coverage?: WhyCoverage["edges"][string];
  callTool: CallTool;
  onClose: () => void;
  onSelectNode: (id: string) => void;
}) {
  const { graph, edgeId } = props;
  const edge = graph.edges.find((e) => e.id === edgeId)!;
  const from = graph.nodes.find((n) => n.id === edge.from);
  const to = graph.nodes.find((n) => n.id === edge.to);
  return (
    <Panel>
      <PanelHead
        title={
          <span>
            {from?.label ?? edge.from} <span className="text-faint">→</span> {to?.label ?? edge.to}
          </span>
        }
        sub={
          <span className="flex items-center gap-2">
            <KindTag>{edge.kind}</KindTag> {edge.label}
          </span>
        }
        onClose={props.onClose}
      />
      <div className="mb-4 flex gap-2">
        {[from, to].map((n) =>
          n ? (
            <button key={n.id} onClick={() => props.onSelectNode(n.id)} className="flex min-w-0 flex-1 items-center gap-2 rounded-[4px] border border-line bg-surface px-2.5 py-2 text-left hover:border-accent/50">
              <KindTile kind={n.kind} size="sm" />
              <span className="truncate text-[12.5px] font-medium text-text">{n.label}</span>
            </button>
          ) : null,
        )}
      </div>

      {props.coverage && (
        <div className="mb-4 flex items-start gap-2.5 rounded-[4px] border border-line bg-surface-2/60 px-3 py-2.5">
          <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", COVERAGE_COPY[props.coverage.status].tone)} />
          <div className="text-[12.5px] leading-snug">
            <span className="font-medium text-text">{COVERAGE_COPY[props.coverage.status].label}.</span>{" "}
            <span className="text-muted">{COVERAGE_COPY[props.coverage.status].text}</span>
            {props.coverage.subject && <div className="mt-1 font-mono text-[11px] text-muted">{props.coverage.subject}</div>}
          </div>
        </div>
      )}

      <Eyebrow>Cited in the code · {edge.evidence.length}</Eyebrow>
      <div className="mb-5 flex flex-col gap-1.5">
        {edge.evidence.slice(0, 3).map((ev) => (
          <CodeCite key={`${ev.path}:${ev.line}`} ev={ev} />
        ))}
      </div>

      <WhyCard key={edgeId} repo={graph.repo.key} edgeId={edgeId} callTool={props.callTool} />
    </Panel>
  );
}

// ---------------------------------------------------------------- why card

function WhyCard({ repo, edgeId, callTool }: { repo: string; edgeId: string; callTool: CallTool }) {
  const [state, setState] = useState<{ phase: "idle" | "running" | "done" | "error"; result?: WhyResult; error?: string; started?: number }>({ phase: "idle" });
  const [now, setNow] = useState(Date.now());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(false);

  useEffect(() => {
    if (state.phase !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [state.phase]);

  const ask = async () => {
    setState({ phase: "running", started: Date.now() });
    setFeedback(null);
    const r = await callTool<WhyResult>("explain_dependency", { repo, edgeId });
    if (r.isError) setState({ phase: "error", error: r.text ?? "The explain agents could not answer." });
    else setState({ phase: "done", result: r.structuredContent });
  };

  const sendFeedback = async (kind: "helpful" | "not_helpful" | "wrong") => {
    const ids = state.result?.output.memory_ids ?? [];
    if (!ids.length) return;
    const r = await callTool<{ updated: { confidence: number }[] }>("memory_feedback", { repo, ids, kind });
    setFeedback(r.isError ? (r.text ?? "Could not record feedback") : `Recorded in the trust ledger · confidence now ${r.structuredContent.updated.map((u) => u.confidence).join(", ")}`);
  };

  if (state.phase === "idle") {
    return (
      <div className="rounded-[4px] border border-accent/40 bg-accent-soft/40 p-4">
        <p className="font-serif text-[22px] leading-tight text-text">Why is this here?</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          Agents follow the cited line to the commit that wrote it, the pull request that merged it and the issue that asked for it. Every claim in the answer is checked by a Critic.
        </p>
        <Button data-tour="why" variant="primary" className="mt-3 w-full" onClick={() => void ask()}>
          <CircleHelp size={14} /> Find out why
        </Button>
      </div>
    );
  }

  if (state.phase === "running") {
    // `now` ticks every 500 ms and can trail the start time on the first render.
    const elapsed = Math.max(0, Math.round((now - (state.started ?? now)) / 1000));
    const stage = [...STAGES].reverse().find((s) => elapsed >= s.after) ?? STAGES[0];
    return (
      <div className="rounded-[4px] border border-accent/50 bg-surface p-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 font-mono text-[11px] tracking-[0.12em] text-accent uppercase">
            <Spinner size={13} /> Investigating
          </span>
          <span className="font-mono text-[12px] text-muted tabular-nums">{elapsed}s</span>
        </div>
        <motion.p key={stage.text} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} className="mt-2.5 text-[13px] leading-relaxed text-text">
          {stage.text}
        </motion.p>
        <ol className="mt-3 flex gap-1">
          {["Plan", "Investigate", "Write", "Critique"].map((s, i) => (
            <li key={s} className={cn("h-1 flex-1 rounded-full", i <= STAGES.indexOf(stage) - 1 ? "bg-accent" : "bg-line")} />
          ))}
        </ol>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="rounded-[4px] border border-danger/40 bg-danger/5 p-4">
        <p className="flex items-center gap-2 text-[13px] font-medium text-danger">
          <TriangleAlert size={15} /> Couldn't answer
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-text/80">{state.error}</p>
        <Button className="mt-3" size="sm" onClick={() => void ask()}>Try again</Button>
      </div>
    );
  }

  const r = state.result!;
  const o = r.output;
  const byId = new Map(o.evidence.map((e) => [e.id, e]));
  const recalled = o.evidence.filter((e) => e.kind === "memory").length;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-[4px] border border-line-strong bg-surface">
      <div className="border-b border-line p-4">
        <p className="font-mono text-[10.5px] tracking-[0.18em] text-muted uppercase">Why it exists</p>
        <p className="mt-2 font-serif text-[20px] leading-snug text-text">{o.answer}</p>
        <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[10.5px] uppercase">
          <span className={cn("rounded-[4px] border px-1.5 py-0.5", o.confidence === "high" ? "border-ok/50 text-ok" : o.confidence === "medium" ? "border-warn/50 text-warn" : "border-danger/50 text-danger")}>
            {o.confidence} confidence
          </span>
          <span className={cn("flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5", o.approved ? "border-ok/50 text-ok" : "border-line text-muted")}>
            {o.approved ? <ShieldCheck size={11} /> : null} {o.approved ? "Critic approved" : "not fully approved"}
          </span>
          {o.rounds > 0 && <span className="rounded-[4px] border border-line px-1.5 py-0.5 text-muted">{o.rounds} revision{o.rounds === 1 ? "" : "s"}</span>}
          {recalled > 0 && (
            <span className="flex items-center gap-1 rounded-[4px] border border-accent/40 px-1.5 py-0.5 text-accent">
              <Brain size={11} /> {recalled} recalled from memory
            </span>
          )}
          <span className="rounded-[4px] border border-line px-1.5 py-0.5 text-muted">{r.cached ? `saved answer · first took ${r.execution_time_seconds}s` : `${r.execution_time_seconds}s`}</span>
        </div>
      </div>

      {o.chain.length > 0 && (
        <div className="border-b border-line p-4">
          <p className="mb-2 font-mono text-[10.5px] tracking-[0.18em] text-muted uppercase">The trail</p>
          <ol className="relative">
            {o.chain.map((step, i) => (
              <li key={step.id} className="relative flex gap-3 pb-3 last:pb-0">
                {i < o.chain.length - 1 && <span className="absolute top-5 left-[9px] h-[calc(100%-12px)] border-l-2 border-dashed border-accent/50" />}
                <span className="z-[1] grid size-5 shrink-0 place-items-center rounded-full border-2 border-accent bg-surface font-mono text-[9px] font-medium text-accent">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11.5px] text-muted">{KIND_LABEL[step.kind]}</span>
                    {step.url?.startsWith("http") ? (
                      <a href={step.url} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 font-mono text-[11.5px] text-text underline decoration-line-strong underline-offset-4 hover:text-accent">
                        {step.ref} <ArrowUpRight size={11} />
                      </a>
                    ) : (
                      <span className="font-mono text-[11.5px] text-text">{step.ref}</span>
                    )}
                  </div>
                  {step.kind !== "code" && <div className="truncate text-[12.5px] text-text">{step.title}</div>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="border-b border-line p-4">
        <p className="mb-2 font-mono text-[10.5px] tracking-[0.18em] text-muted uppercase">Claims, each with its proof</p>
        {o.claims.map((c) => (
          <p key={c.text} className="mb-2 text-[12.5px] leading-relaxed text-text last:mb-0">
            {c.text}{" "}
            {c.evidence.map((id) => {
              const ev = byId.get(id);
              return ev?.url?.startsWith("http") ? (
                <a key={id} href={ev.url} target="_blank" rel="noreferrer" title={`${KIND_LABEL[ev.kind]} ${ev.ref}: ${ev.title}`} className="font-mono text-[10.5px] text-accent hover:underline">
                  [{ev.ref}]
                </a>
              ) : (
                <span key={id} title={ev ? `${KIND_LABEL[ev.kind]}: ${ev.title}` : id} className="font-mono text-[10.5px] text-accent">
                  [{ev?.ref ?? id}]
                </span>
              );
            })}
          </p>
        ))}
        {o.unknowns.length > 0 && (
          <div className="mt-3 rounded-[4px] bg-surface-2/70 px-3 py-2">
            <p className="font-mono text-[10px] tracking-[0.16em] text-muted uppercase">Not in the evidence</p>
            {o.unknowns.map((u) => (
              <p key={u} className="mt-1 text-[12px] leading-snug text-muted">{u}</p>
            ))}
          </div>
        )}
      </div>

      {o.memory_ids.length > 0 && (
        <div className="border-b border-line p-4">
          <p className="flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.18em] text-muted uppercase">
            <Brain size={12} /> Remembered · Meterless H-MEM
          </p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-text/80">
            {o.memory_ids.length} approved finding{o.memory_ids.length === 1 ? "" : "s"} stored with their sources. The next question about this code starts from them, and they're retired if the code changes. Was this right?
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => void sendFeedback("helpful")}><ThumbsUp size={13} /> Helpful</Button>
            <Button size="sm" onClick={() => void sendFeedback("not_helpful")}><Minus size={13} /> Not helpful</Button>
            <Button size="sm" variant="danger" onClick={() => void sendFeedback("wrong")}><ThumbsDown size={13} /> Wrong</Button>
          </div>
          {feedback && <p className="mt-2 font-mono text-[11px] text-muted">{feedback}</p>}
        </div>
      )}

      <button onClick={() => setShowTrace((v) => !v)} className="flex w-full items-center justify-between px-4 py-2.5 font-mono text-[10.5px] tracking-[0.18em] text-muted uppercase hover:text-text">
        Agent trace · {r.trace.length} steps
        <ChevronDown size={14} className={cn("transition-transform", showTrace && "rotate-180")} />
      </button>
      {showTrace && (
        <ol className="border-t border-line px-4 py-3 text-[12px]">
          {r.trace.map((t, i) => (
            <li key={i} className="mb-2 last:mb-0">
              <span className="font-mono text-[11px] font-medium text-text uppercase">{t.agent_name}</span>
              {t.target_agent ? <span className="text-faint"> → {t.target_agent}</span> : null}
              <span className="text-muted"> · {t.action}</span>
              <div className={cn("leading-snug", t.status === "needs_revision" ? "text-warn" : t.status === "error" ? "text-danger" : "text-text/80")}>{t.output_summary}</div>
            </li>
          ))}
        </ol>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------- coverage legend (map overlay)

export function CoverageLegend(props: { on: boolean; loading: boolean; error: string | null; data: WhyCoverage | null; onToggle: () => void }) {
  const { data } = props;
  const total = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;
  const traced = data ? total - data.counts.unknown : 0;
  const pct = data && traced ? Math.round((data.counts.explained / traced) * 100) : null;
  return (
    <div className="absolute top-3 left-3 z-10 w-[284px] rounded-[6px] border border-text bg-surface/95 shadow-card backdrop-blur-sm">
      <button onClick={props.onToggle} className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left">
        <span>
          <span className="block font-mono text-[10.5px] tracking-[0.16em] text-text uppercase">Why-coverage</span>
          <span className="block text-[12.5px] text-muted">{props.on ? "Arrows coloured by their stated reason" : "Which arrows have a stated reason?"}</span>
        </span>
        <span className={cn("grid size-8 place-items-center rounded-[4px] border", props.on ? "border-accent bg-accent text-white" : "border-line text-muted")}>
          {props.on ? <Eye size={15} /> : <EyeOff size={15} />}
        </span>
      </button>
      {props.on && (
        <div className="border-t border-line px-3.5 py-3">
          {props.loading ? (
            <p className="flex items-center gap-2 text-[12.5px] text-muted"><Spinner size={12} /> Reading the history behind every arrow…</p>
          ) : props.error ? (
            <p className="text-[12.5px] leading-snug text-danger">{props.error}</p>
          ) : data ? (
            <>
              {pct !== null && (
                <p className="mb-2 font-serif text-[30px] leading-none text-text">
                  {pct}%<span className="ml-1.5 font-sans text-[12.5px] text-muted">of traced arrows have a stated reason</span>
                </p>
              )}
              <ul className="space-y-1">
                {(["explained", "reviewed", "unreviewed", "unknown"] as CoverageStatus[]).map((s) => (
                  <li key={s} className="flex items-center justify-between text-[13px]">
                    <span className="flex items-center gap-2 text-text">
                      <span className={cn("h-1 w-5 rounded-full", COVERAGE_COPY[s].tone)} /> {COVERAGE_COPY[s].label}
                    </span>
                    <span className="font-mono text-muted">{data.counts[s]}</span>
                  </li>
                ))}
              </ul>
              {!data.github && <p className="mt-2 text-[12px] leading-snug text-muted">Local repository: commits only, no pull requests to read.</p>}
              <p className="mt-2 text-[12px] leading-snug text-faint">Click any arrow to ask why it exists.</p>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
