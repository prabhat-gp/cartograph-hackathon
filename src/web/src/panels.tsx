// Side panels and full-screen states of the Cartograph UI.
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronRight,
  CircleCheck,
  Compass,
  GitCommitHorizontal,
  Map as MapIcon,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  SkipBack,
  SkipForward,
  X,
  Zap,
} from "lucide-react";
import { motion } from "motion/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { CartographGraph, DriftReport, NodeKind } from "../../shared/graph";
import { shortSha } from "../../shared/graph";
import { type FlowView, blastRadius } from "../../server/graph/analysis";
import type { JobView, RepoSummary } from "./App";
import { CartographLogo } from "./icons";
import { kindMeta } from "./kinds";
import {
  AskButton,
  Button,
  Card,
  Chip,
  CodeCite,
  Eyebrow,
  IconButton,
  KindChip,
  KindTag,
  KindTile,
  SeverityBadge,
  type SeverityLevel,
  Spinner,
  ago,
  cn,
  severityColor,
} from "./ui";

const fadeIn = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.22, ease: "easeOut" as const } };

function Panel({ children }: { children: ReactNode }) {
  return (
    <motion.div {...fadeIn} className="px-5 pt-5 pb-7">
      {children}
    </motion.div>
  );
}

function PanelHead({ title, sub, icon, onClose }: { title: ReactNode; sub?: ReactNode; icon?: ReactNode; onClose?: () => void }) {
  return (
    <div className="mb-3 flex items-start gap-3">
      {icon}
      <div className="min-w-0 flex-1">
        <h2 className="m-0 font-serif text-[24px] leading-tight font-normal text-text">{title}</h2>
        {sub && <div className="mt-0.5 text-[12px] text-muted">{sub}</div>}
      </div>
      {onClose && (
        <IconButton label="Close" onClick={onClose} className="-mt-1 -mr-2">
          <X size={16} />
        </IconButton>
      )}
    </div>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return <p className="my-3 text-[13px] leading-[1.6] text-text/85">{children}</p>;
}

function Row({ onClick, leading, title, sub, meta, tone = "default", active = false }: { onClick?: () => void; leading: ReactNode; title: ReactNode; sub?: ReactNode; meta?: ReactNode; tone?: "default" | "danger"; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all",
        active ? "border-accent/40 bg-accent-soft/60" : "border-transparent hover:border-line hover:bg-surface-2/70",
        tone === "danger" && "hover:border-danger/30 hover:bg-danger/[0.04]",
      )}
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-text">{title}</span>
        {sub && <span className="mt-0.5 block truncate text-[11.5px] text-muted">{sub}</span>}
      </span>
      {meta && <span className="shrink-0 text-[11.5px] text-faint">{meta}</span>}
      <ChevronRight size={14} className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function PlayBubble({ tone = "accent" }: { tone?: "accent" | "danger" }) {
  return (
    <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", tone === "accent" ? "bg-accent-soft text-accent" : "bg-danger/10 text-danger")}>
      {tone === "accent" ? <Play size={13} fill="currentColor" strokeWidth={0} className="translate-x-[1px]" /> : <X size={14} strokeWidth={2.4} />}
    </span>
  );
}

/** Reviewer prose: `code` spans become inline code. */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/`([^`]+)`/).map((part, i) =>
        i % 2 ? (
          <code key={i} className="rounded bg-surface-3 px-1 py-px font-mono text-[11px] text-text">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

// ---------------------------------------------------------------- overview

export function OverviewPanel({ graph, onTrace, onSelect, onAsk }: { graph: CartographGraph; onTrace: (id: string) => void; onSelect: (id: string) => void; onAsk: (t: string) => void }) {
  const byKind = useMemo(() => {
    const m = new Map<NodeKind, CartographGraph["nodes"]>();
    for (const n of graph.nodes) m.set(n.kind, [...(m.get(n.kind) ?? []), n]);
    return [...m.entries()];
  }, [graph]);
  const s = graph.stats;
  return (
    <Panel>
      <PanelHead title="Architecture" sub={`${graph.repo.name} · mapped ${ago(graph.generatedAt)}`} />
      <Prose>{graph.summary}</Prose>
      <div className="flex flex-wrap gap-1.5">
        {graph.stack.slice(0, 10).map((t) => (
          <Chip key={t}>{t.length > 34 ? `${t.slice(0, 32)}…` : t}</Chip>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        {[
          [graph.nodes.length, "components"],
          [graph.edges.length, "dependencies"],
          [graph.flows.length, "flows"],
        ].map(([n, l]) => (
          <Card key={l} className="px-3 py-2.5">
            <div className="font-serif text-[34px] leading-none font-normal text-text tabular-nums">{n}</div>
            <div className="mt-1 text-[11.5px] text-muted">{l}</div>
          </Card>
        ))}
      </div>

      <div className="mt-3 flex gap-3 rounded-xl border border-ok/25 bg-ok/[0.06] px-3.5 py-3">
        <ShieldCheck size={18} className="mt-[1px] shrink-0 text-ok" />
        <div className="text-[12.5px] leading-relaxed">
          <div className="font-semibold text-text">Every arrow cites the code</div>
          <div className="mt-0.5 text-muted">
            {s.edgesProposed} proposed · <b className="font-semibold text-text">{s.edgesVerified} verified</b> · {s.edgesDropped} dropped at{" "}
            <span className="font-mono text-[11.5px]">{shortSha(graph.sha)}</span>
            <br />
            {s.files} files read · {s.model}
            {s.durationMs ? ` · ${Math.round(s.durationMs / 1000)}s` : ""}
          </div>
        </div>
      </div>

      <Eyebrow className="mt-6">Flows</Eyebrow>
      <div className="-mx-1.5 flex flex-col">
        {graph.flows.map((f) => (
          <Row key={f.id} onClick={() => onTrace(f.id)} leading={<PlayBubble />} title={f.name} sub={f.trigger} meta={`${f.steps.length} hops`} />
        ))}
      </div>

      <Eyebrow className="mt-6">Components</Eyebrow>
      <div className="flex flex-col gap-2.5">
        {byKind.map(([kind, nodes]) => (
          <div key={kind} className="flex items-start gap-3">
            <div className="w-[88px] shrink-0 pt-[3px]">
              <KindChip kind={kind} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {nodes.map((n) => (
                <button key={n.id} onClick={() => onSelect(n.id)} className="rounded-md border border-line bg-surface px-2 py-[3px] text-[12px] text-text shadow-card transition-colors hover:border-accent/40 hover:text-accent">
                  {n.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <AskButton onClick={() => onAsk(`Give me a 60-second tour of the ${graph.repo.name} architecture as a new engineer on the team.`)}>Ask for a 60-second tour</AskButton>
    </Panel>
  );
}

export function FlowsPanel({ graph, onTrace, onAsk }: { graph: CartographGraph; onTrace: (id: string) => void; onAsk: (t: string) => void }) {
  return (
    <Panel>
      <PanelHead title="Flows" sub="Requests traced hop by hop through real code" />
      <div className="-mx-1.5 mt-2 flex flex-col">
        {graph.flows.map((f) => (
          <Row key={f.id} onClick={() => onTrace(f.id)} leading={<PlayBubble />} title={f.name} sub={f.description} meta={`${f.steps.length} hops`} />
        ))}
      </div>
      <AskButton onClick={() => onAsk(`In ${graph.repo.name}, what happens when `)}>Ask about another flow…</AskButton>
    </Panel>
  );
}

// ---------------------------------------------------------------- trace

export function TracePanel(props: { flow: FlowView; step: number; playing: boolean; onStep: (i: number) => void; onPlay: () => void; onClose: () => void; onAsk: () => void }) {
  const { flow, step } = props;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector("[data-on='true']")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [step]);
  const last = flow.steps.length - 1;
  const pct = flow.steps.length ? ((step + 1) / flow.steps.length) * 100 : 0;
  return (
    <Panel>
      <PanelHead title={flow.name} sub={flow.trigger} onClose={props.onClose} />
      <Prose>{flow.description}</Prose>

      <Card className="sticky top-0 z-10 mb-4 flex items-center gap-1.5 px-2 py-2">
        <IconButton label="Previous step" disabled={step === 0} onClick={() => props.onStep(Math.max(0, step - 1))}>
          <SkipBack size={15} />
        </IconButton>
        <Button size="sm" variant="primary" onClick={props.onPlay} className="min-w-[84px]">
          {props.playing ? <Pause size={13} fill="currentColor" strokeWidth={0} /> : step >= last ? <RotateCcw size={13} /> : <Play size={13} fill="currentColor" strokeWidth={0} />}
          {props.playing ? "Pause" : step >= last ? "Replay" : "Play"}
        </Button>
        <IconButton label="Next step" disabled={step >= last} onClick={() => props.onStep(Math.min(last, step + 1))}>
          <SkipForward size={15} />
        </IconButton>
        <div className="mx-2 h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
          <motion.div className="h-full rounded-full bg-gradient-to-r from-accent-2 to-accent" animate={{ width: `${pct}%` }} transition={{ duration: 0.4 }} />
        </div>
        <span className="pr-1 font-mono text-[11.5px] text-muted tabular-nums">
          {step + 1}/{flow.steps.length}
        </span>
      </Card>

      <div ref={list} className="relative">
        <div className="absolute top-3 bottom-3 left-[11px] w-px bg-line" />
        {flow.steps.map((s, i) => {
          const on = i === step;
          const done = i < step;
          return (
            <button key={s.index} data-on={on} onClick={() => props.onStep(i)} className="relative flex w-full gap-3 pb-3 text-left">
              <span
                className={cn(
                  "relative z-[1] mt-[3px] grid size-[23px] shrink-0 place-items-center rounded-full border text-[11px] font-semibold tabular-nums transition-colors",
                  on ? "border-accent bg-accent text-white shadow-[0_0_0_4px_var(--accent-soft)]" : done ? "border-accent/50 bg-accent-soft text-accent" : "border-line bg-surface text-faint",
                )}
              >
                {s.index}
              </span>
              <span className={cn("min-w-0 flex-1 rounded-xl border px-3 py-2.5 transition-all", on ? "border-accent/35 bg-surface shadow-card" : "border-transparent", !on && !done && "opacity-55")}>
                <span className="block text-[13px] leading-snug font-semibold text-text">
                  {s.from.label}
                  <ArrowRight size={13} className="mx-1 inline -translate-y-px text-accent" />
                  {s.to.label}
                </span>
                <span className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted">
                  <KindTag>{s.kind}</KindTag>
                  <span className="truncate">{s.label}</span>
                </span>
                {(on || done) && <span className="mt-1.5 block text-[12.5px] leading-relaxed text-text/80">{s.note}</span>}
                {on && <CodeCite ev={s.evidence} className="mt-2.5" />}
              </span>
            </button>
          );
        })}
      </div>
      <AskButton onClick={props.onAsk}>What could go wrong in this flow?</AskButton>
    </Panel>
  );
}

// ---------------------------------------------------------------- component

export function NodePanel({ graph, nodeId, onClose, onSelect, onBlast, onAsk }: { graph: CartographGraph; nodeId: string; onClose: () => void; onSelect: (id: string) => void; onBlast: (id: string) => void; onAsk: (t: string) => void }) {
  const node = graph.nodes.find((n) => n.id === nodeId);
  const nodes = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  if (!node) return null;
  const out = graph.edges.filter((e) => e.from === node.id);
  const inc = graph.edges.filter((e) => e.to === node.id);
  const Dep = ({ e, dir }: { e: (typeof graph.edges)[number]; dir: "out" | "in" }) => {
    const other = nodes.get(dir === "out" ? e.to : e.from);
    return (
      <div className="mb-3">
        <button onClick={() => other && onSelect(other.id)} className="group mb-1.5 flex w-full items-center gap-2 text-left">
          {other && <KindTile kind={other.kind} size="sm" />}
          <span className="truncate text-[13px] font-medium text-text group-hover:text-accent">{other?.label ?? "?"}</span>
          <KindTag>{e.kind}</KindTag>
          <span className="truncate text-[11.5px] text-muted">{e.label}</span>
        </button>
        <CodeCite ev={e.evidence[0]} />
      </div>
    );
  };
  return (
    <Panel>
      <PanelHead icon={<KindTile kind={node.kind} size="lg" />} title={node.label} sub={[kindMeta(node.kind).label, node.tech].filter(Boolean).join(" · ")} onClose={onClose} />
      <Prose>{node.summary}</Prose>
      {node.details.length > 0 &&
        (node.details.every((d) => d.length <= 42) ? (
          // Short facts (endpoints, tables, queue names) read best as code chips…
          <div className="mb-3 flex flex-wrap gap-1.5">
            {node.details.map((d) => (
              <Chip key={d} className="font-mono text-[11px]">
                {d}
              </Chip>
            ))}
          </div>
        ) : (
          // …while sentences read best as a list.
          <ul className="mb-4 flex list-none flex-col gap-1.5 p-0">
            {node.details.map((d) => (
              <li key={d} className="flex gap-2 text-[12.5px] leading-relaxed text-text/80">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent/50" />
                {d}
              </li>
            ))}
          </ul>
        ))}
      {node.files.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {node.files.slice(0, 8).map((f) => (
            <span key={f.path} className="rounded-md bg-surface-2 px-1.5 py-[2px] font-mono text-[11px] text-muted">
              {f.path}
            </span>
          ))}
        </div>
      )}
      <Button variant="danger" className="w-full" onClick={() => onBlast(node.id)}>
        <Zap size={14} /> What breaks if this goes down?
      </Button>
      {out.length > 0 && <Eyebrow className="mt-6">Depends on · {out.length}</Eyebrow>}
      {out.map((e) => (
        <Dep key={e.id} e={e} dir="out" />
      ))}
      {inc.length > 0 && <Eyebrow className="mt-5">Used by · {inc.length}</Eyebrow>}
      {inc.map((e) => (
        <Dep key={e.id} e={e} dir="in" />
      ))}
      <AskButton onClick={() => onAsk(`Explain the ${node.label} component in ${graph.repo.name}: what it does and how it fits in.`)}>Ask about {node.label}</AskButton>
    </Panel>
  );
}

// ---------------------------------------------------------------- outage

export function BlastPanel({ graph, nodeId, onClose, onAsk, onTrace }: { graph: CartographGraph; nodeId: string; onClose: () => void; onAsk: (t: string) => void; onTrace: (id: string) => void }) {
  const b = useMemo(() => blastRadius(graph, nodeId), [graph, nodeId]);
  if (!b) return null;
  return (
    <Panel>
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-danger/25 bg-danger/[0.05] px-3.5 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-danger/12 text-danger">
          <Zap size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-danger">{b.node.label} is down</div>
          <div className="text-[12px] text-muted">Simulated outage · {b.impacted.length} components affected</div>
        </div>
        <IconButton label="Close" onClick={onClose} className="-mt-1 -mr-2">
          <X size={16} />
        </IconButton>
      </div>
      <Prose>{b.summary}</Prose>
      {b.brokenFlows.length > 0 && (
        <>
          <Eyebrow className="mt-5">Broken flows</Eyebrow>
          <div className="-mx-1.5 flex flex-col">
            {b.brokenFlows.map((f) => (
              <Row key={f.id} tone="danger" onClick={() => onTrace(f.id)} leading={<PlayBubble tone="danger" />} title={f.name} sub={f.trigger} />
            ))}
          </div>
        </>
      )}
      {b.impacted.length > 0 && <Eyebrow className="mt-5">Impacted components</Eyebrow>}
      <div className="flex flex-col gap-1.5">
        {b.impacted.map((i) => (
          <div key={i.node.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1">
            <KindTile kind={i.node.kind} size="sm" />
            <span className="flex-1 truncate text-[13px] font-medium text-text">{i.node.label}</span>
            <span className={cn("rounded-full px-2 py-[2px] text-[10.5px] font-semibold", i.depth === 1 ? "bg-danger/10 text-danger" : "bg-surface-2 text-muted")}>
              {i.depth === 1 ? "direct" : `${i.depth} hops`}
            </span>
          </div>
        ))}
      </div>
      <AskButton onClick={() => onAsk(`If ${b.node.label} goes down in ${graph.repo.name}, how should we make the system degrade gracefully? Be specific to this architecture.`)}>How do we make this resilient?</AskButton>
    </Panel>
  );
}

// ---------------------------------------------------------------- drift

export function DriftPanel(props: {
  reports: DriftReport[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  onAsk: (t: string) => void;
  onCheck: () => void;
  reviewing: boolean;
  graph: CartographGraph;
  demo?: { run: (action: "drift" | "fix") => void; message: string | null };
}) {
  const { reports } = props;
  const active = reports.find((r) => r.id === props.activeId) ?? reports[0];
  const nodes = new Map(props.graph.nodes.map((n) => [n.id, n]));
  const lbl = (id: string) => nodes.get(id)?.label ?? active?.removed.nodes.find((n) => n.id === id)?.label ?? active?.added.nodes.find((n) => n.id === id)?.label ?? id;
  return (
    <Panel>
      <PanelHead title="Architecture drift" sub="Every push, reviewed at the architecture level" onClose={props.onClose} />

      {props.reviewing && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-warn/30 bg-warn/[0.07] px-3 py-2.5 text-[12.5px] font-medium text-warn">
          <Spinner /> Reviewing a new push…
        </div>
      )}

      {!active && !props.reviewing && (
        <Card className="px-4 py-5 text-center">
          <GitCommitHorizontal size={22} className="mx-auto text-faint" />
          <p className="mx-auto mt-2 mb-3 max-w-[260px] text-[12.5px] leading-relaxed text-muted">No pushes reviewed yet. Push a commit and Cartograph reviews its architecture within a minute.</p>
          <Button size="sm" onClick={props.onCheck}>
            Check latest commit now
          </Button>
        </Card>
      )}

      {active && (
        <Card className="relative overflow-hidden">
          <div className={cn("absolute inset-y-0 left-0 w-1", severityColor(active.maxSeverity as SeverityLevel))} />
          <div className="px-4 pt-3.5 pb-4 pl-5">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge level={active.maxSeverity as SeverityLevel} />
              <span className="font-mono text-[11.5px] text-muted">
                {shortSha(active.fromSha)} → {shortSha(active.toSha)}
              </span>
              <span className="ml-auto text-[11.5px] text-faint">{ago(active.at)}</span>
            </div>
            {active.commits[0] && (
              <div className="mt-2.5 flex items-start gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-3 text-[10px] font-semibold text-muted">
                  {(active.commits[0].author ?? "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] leading-snug font-semibold text-text">{active.commits[0].message}</div>
                  <div className="text-[11.5px] text-muted">
                    {active.commits[0].author}
                    {active.commits.length > 1 ? ` · +${active.commits.length - 1} more commit${active.commits.length > 2 ? "s" : ""}` : ""}
                  </div>
                </div>
              </div>
            )}
            <Prose>
              <RichText text={active.summary} />
            </Prose>

            {active.findings.map((f) => (
              <div key={f.id} className={cn("mt-2 rounded-lg border px-3 py-2.5", f.severity === "critical" ? "border-danger/25 bg-danger/[0.04]" : f.severity === "warning" ? "border-warn/25 bg-warn/[0.05]" : "border-info/20 bg-info/[0.04]")}>
                <div className="flex items-start gap-2">
                  <SeverityBadge level={f.severity} className="mt-[1px] shrink-0" />
                  <div className="text-[12.5px] leading-snug font-semibold text-text">{f.title}</div>
                </div>
                <div className="mt-1.5 text-[12px] leading-relaxed text-text/75"><RichText text={f.detail} /></div>
              </div>
            ))}

            {(active.added.edges.length > 0 || active.removed.edges.length > 0) && (
              <>
                <Eyebrow className="mt-4">Dependency changes</Eyebrow>
                <div className="flex flex-col gap-2.5">
                  {active.added.edges.map((e) => (
                    <div key={e.id}>
                      <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px]">
                        <span className="grid size-4 place-items-center rounded bg-ok/15 font-mono text-[11px] font-bold text-ok">+</span>
                        <span className="truncate font-medium text-text">
                          {lbl(e.from)} → {lbl(e.to)}
                        </span>
                        <KindTag>{e.kind}</KindTag>
                      </div>
                      <CodeCite ev={e.evidence[0]} />
                    </div>
                  ))}
                  {active.removed.edges.map((e) => (
                    <div key={e.id} className="flex items-center gap-1.5 text-[12.5px] text-muted">
                      <span className="grid size-4 place-items-center rounded bg-danger/12 font-mono text-[11px] font-bold text-danger">−</span>
                      <span className="truncate line-through">
                        {lbl(e.from)} → {lbl(e.to)}
                      </span>
                      <KindTag>{e.kind}</KindTag>
                    </div>
                  ))}
                </div>
              </>
            )}
            {active.maxSeverity !== "none" && (
              <AskButton
                onClick={() =>
                  props.onAsk(
                    `Cartograph flagged architecture drift in ${props.graph.repo.name} commit ${shortSha(active.toSha)}: ${active.findings[0]?.title ?? active.summary}. Suggest the right fix that keeps the intended layering, with code.`,
                  )
                }
              >
                Suggest a fix
              </AskButton>
            )}
          </div>
        </Card>
      )}

      {props.demo && (
        <Card className="mt-4 px-4 py-3.5">
          <div className="text-[13px] font-semibold text-text">Try it: simulate a push</div>
          <div className="mt-0.5 mb-3 text-[12px] text-muted">Commits to the demo repo, exactly like a developer pushing.</div>
          <div className="flex gap-2">
            <Button size="sm" variant="danger" className="flex-1" onClick={() => props.demo!.run("drift")}>
              Push a bad commit
            </Button>
            <Button size="sm" className="flex-1" onClick={() => props.demo!.run("fix")}>
              Push the fix
            </Button>
          </div>
          {props.demo.message && <div className="mt-2.5 text-[12px] text-muted">{props.demo.message}</div>}
        </Card>
      )}

      {reports.length > 1 && (
        <>
          <Eyebrow className="mt-6">Recent pushes</Eyebrow>
          <div className="relative">
            <div className="absolute top-2 bottom-2 left-[7px] w-px bg-line" />
            {reports.slice(0, 12).map((r) => (
              <button key={r.id} onClick={() => props.onSelect(r.id)} className={cn("relative flex w-full items-start gap-3 rounded-lg py-1.5 pr-2 text-left transition-colors", r.id === active?.id ? "" : "opacity-80 hover:opacity-100")}>
                <span className={cn("relative z-[1] mt-[5px] size-[15px] shrink-0 rounded-full border-[3px] border-surface", severityColor(r.maxSeverity as SeverityLevel), r.id === active?.id && "ring-2 ring-accent/40")} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[12.5px]", r.id === active?.id ? "font-semibold text-text" : "text-text")}>{r.commits[0]?.message ?? shortSha(r.toSha)}</span>
                  <span className="block text-[11px] text-muted">
                    <span className="font-mono">{shortSha(r.toSha)}</span> · {r.maxSeverity === "none" ? "no drift" : `${r.findings.length} finding${r.findings.length === 1 ? "" : "s"}`} · {ago(r.at)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- live mapping progress

type AgentState = "todo" | "run" | "done" | "err";

interface ReaderCard {
  index: number;
  total: number;
  name: string;
  files: string;
  state: AgentState;
  result: string | null;
  seconds: number | null;
}

/** Readers announce themselves as "Reader 2/5 · api-core · 9 files" and finish with a count. */
function readerCards(log: JobView["log"], now: number): ReaderCard[] {
  const cards = new Map<string, ReaderCard & { startedAt: number }>();
  for (const l of log) {
    if (l.agent !== "reader") continue;
    const m = l.message.match(/^Reader (\d+)\/(\d+) · (.+?) · (.+)$/);
    if (!m) continue;
    const [, i, n, name, tail] = m;
    const at = Date.parse(l.at);
    const card = cards.get(name) ?? { index: Number(i), total: Number(n), name, files: "", state: "run" as AgentState, result: null, seconds: null, startedAt: at };
    if (l.phase === "start") card.files = tail;
    if (l.phase === "done") {
      card.state = "done";
      card.result = tail;
      card.seconds = Math.round((at - card.startedAt) / 1000);
    }
    if (l.phase === "error") {
      card.state = "err";
      card.result = tail;
    }
    cards.set(name, card);
  }
  return [...cards.values()]
    .sort((a, b) => a.index - b.index)
    .map(({ startedAt, ...c }) => (c.state === "run" ? { ...c, seconds: Math.round((now - startedAt) / 1000) } : c));
}

function AgentBadge({ state }: { state: AgentState }) {
  if (state === "done") return <span className="flex items-center gap-1 font-mono text-[10.5px] tracking-wide text-ok uppercase"><CircleCheck size={13} /> done</span>;
  if (state === "run") return <span className="flex items-center gap-1.5 font-mono text-[10.5px] tracking-wide text-accent uppercase"><Spinner size={12} /> working</span>;
  if (state === "err") return <span className="font-mono text-[10.5px] tracking-wide text-danger uppercase">failed</span>;
  return <span className="font-mono text-[10.5px] tracking-wide text-faint uppercase">waiting</span>;
}

function AgentCard(props: { Icon: typeof Compass; name: string; role: string; state: AgentState; detail?: ReactNode; className?: string }) {
  const { Icon, state } = props;
  return (
    <div
      className={cn(
        "relative rounded-[4px] border bg-surface px-4 py-3.5 transition-all duration-300",
        state === "run" ? "border-accent shadow-[3px_3px_0_0_var(--accent)]" : state === "done" ? "border-line-strong shadow-card" : state === "err" ? "border-danger/60" : "border-line opacity-70",
        props.className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2.5">
          <span className={cn("grid size-8 place-items-center rounded-[3px]", state === "run" ? "bg-accent text-white" : state === "done" ? "bg-ok/12 text-ok" : "bg-surface-2 text-faint")}>
            <Icon size={16} />
          </span>
          <span>
            <span className="block font-mono text-[12px] font-medium tracking-[0.1em] text-text uppercase">{props.name}</span>
            <span className="block text-[11.5px] text-muted">{props.role}</span>
          </span>
        </span>
        <AgentBadge state={state} />
      </div>
      {props.detail ? <div className="mt-2.5 text-[12.5px] leading-snug text-text">{props.detail}</div> : null}
    </div>
  );
}

type SurveyStage = "scout" | "readers" | "cartographer" | "verifier" | "done";

const STAGE_COPY: Record<SurveyStage, { step: number; title: string; now: string; next: string }> = {
  scout: {
    step: 1,
    title: "Scout plans the survey",
    now: "Reading the file tree, package manifests and config to name the components and split the code into reading groups.",
    next: "Readers start on each group at the same time.",
  },
  readers: {
    step: 2,
    title: "Readers read the code",
    now: "Each Reader takes one group of files, finds the calls between components (HTTP, SQL, queues, SDKs) and cites the exact line for each.",
    next: "The Cartographer joins their findings into one map.",
  },
  cartographer: {
    step: 3,
    title: "Cartographer draws the map",
    now: "Merging duplicate findings, naming the components and tracing the routes a request takes through the system.",
    next: "The Verifier checks every citation.",
  },
  verifier: {
    step: 4,
    title: "Verifier checks every road",
    now: "Opening each cited line in the code. A road whose citation doesn't match is taken off the map: no citation, no road.",
    next: "The map opens.",
  },
  done: { step: 4, title: "Survey complete", now: "The map is ready.", next: "" },
};

/** An animated sketch of the survey, in step with the real agents. */
function SurveyAnimation({ stage, lanes, finished }: { stage: SurveyStage; lanes: number; finished: number }) {
  const n = Math.max(3, Math.min(lanes || 4, 6));
  const laneX = (i: number) => 40 + (i * 280) / (n - 1);
  const on = (s: SurveyStage) => stage === s;
  const past = (s: SurveyStage) => STAGE_COPY[stage].step > STAGE_COPY[s].step || stage === "done";
  const nodes = [
    { x: 70, y: 318 }, { x: 180, y: 300 }, { x: 290, y: 318 },
    { x: 110, y: 388 }, { x: 250, y: 388 }, { x: 180, y: 360 },
  ];
  const roads: [number, number, boolean][] = [[0, 1, true], [1, 2, true], [0, 3, true], [1, 5, true], [2, 4, false], [5, 4, true], [3, 5, true]];
  const drawn = past("cartographer") || on("cartographer") || on("verifier");
  const copy = STAGE_COPY[stage];
  return (
    <div className="rounded-[4px] border border-line-strong bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-2 font-mono text-[10.5px] tracking-[0.2em] text-muted uppercase">
        <span>How the survey works</span>
        <span>Step {copy.step} of 4</span>
      </div>
      <svg viewBox="0 0 360 420" className="block w-full" role="img" aria-label={copy.title}>
        <defs>
          <pattern id="sg" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="var(--grid)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="360" height="420" fill="url(#sg)" />

        {/* The repository */}
        <g opacity={on("scout") ? 1 : 0.75}>
          <rect x="130" y="16" width="100" height="58" rx="3" fill="var(--surface)" stroke="var(--text)" strokeWidth="1.4" />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x="142" y={28 + i * 10} width={[60, 44, 70, 36][i]} height="4" rx="1" fill="var(--line-strong)" />
          ))}
          <text x="180" y="90" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9.5" fill="var(--muted)" letterSpacing="1.5">REPOSITORY</text>
        </g>

        {/* Scout: a compass sweeping the repository */}
        <g transform="translate(262 45)" opacity={on("scout") ? 1 : 0.35}>
          <circle r="16" fill="var(--surface)" stroke={on("scout") ? "var(--accent)" : "var(--line-strong)"} strokeWidth="1.6" />
          <g className={on("scout") ? "cg-spin" : undefined}>
            <path d="M0 -11 L3.5 0 L0 11 L-3.5 0 Z" fill="var(--accent)" />
          </g>
          {on("scout") && <circle r="16" fill="none" stroke="var(--accent)" strokeOpacity="0.4" className="cg-ping" />}
        </g>

        {/* Reader lanes */}
        {Array.from({ length: n }, (_, i) => {
          const x = laneX(i);
          const done = past("readers") || i < finished;
          const active = on("readers") && !done;
          const d = `M180 98 C 180 140, ${x} 130, ${x} 178`;
          return (
            <g key={i} opacity={STAGE_COPY[stage].step >= 2 ? 1 : 0.25}>
              <path d={d} fill="none" stroke={active ? "var(--accent)" : "var(--edge)"} strokeWidth="1.4" strokeDasharray={active ? "5 4" : undefined} className={active ? "cg-flow" : undefined} />
              {active && [0, 1, 2].map((k) => (
                <circle key={k} r="2.6" fill="var(--accent)">
                  <animateMotion dur="1.8s" begin={`${k * 0.6 + i * 0.15}s`} repeatCount="indefinite" path={d} />
                </circle>
              ))}
              <rect x={x - 17} y="180" width="34" height="34" rx="3" fill={done ? "var(--ok)" : "var(--surface)"} fillOpacity={done ? 0.14 : 1} stroke={done ? "var(--ok)" : active ? "var(--accent)" : "var(--line-strong)"} strokeWidth="1.4" />
              {done ? (
                <path d={`M${x - 7} 197 l5 5 l9 -10`} fill="none" stroke="var(--ok)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <g transform={`translate(${x - 7} 189)`} stroke={active ? "var(--accent)" : "var(--faint)"} strokeWidth="1.5" fill="none">
                  <path d="M0 2h6v13H0zM8 2h6v13H8z" />
                </g>
              )}
            </g>
          );
        })}
        <text x="180" y="236" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9.5" fill="var(--muted)" letterSpacing="1.5">READERS · IN PARALLEL</text>

        {/* Funnel into the map */}
        <path d="M60 246 C 120 262, 240 262, 300 246" fill="none" stroke="var(--edge)" strokeOpacity={drawn ? 0.9 : 0.3} strokeWidth="1.2" strokeDasharray="3 4" />

        {/* Cartographer: places appear, roads draw */}
        {roads.map(([a, b, ok], i) => {
          const p = nodes[a];
          const q = nodes[b];
          const verifying = on("verifier");
          const rejected = (verifying || stage === "done") && !ok;
          return (
            <g key={i}>
              <motion.path
                d={`M${p.x} ${p.y} L${q.x} ${q.y}`}
                fill="none"
                stroke={rejected ? "var(--faint)" : verifying || stage === "done" ? "var(--ok)" : "var(--text)"}
                strokeOpacity={rejected ? 0.4 : 0.75}
                strokeWidth="1.6"
                strokeDasharray={rejected ? "3 4" : undefined}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: drawn ? 1 : 0 }}
                transition={{ duration: 0.7, delay: drawn ? 0.25 * i : 0, repeat: on("cartographer") ? Infinity : 0, repeatDelay: 2.4 }}
              />
              {(verifying || stage === "done") && (
                <motion.g initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.35 * i, type: "spring", stiffness: 300 }}
                  style={{ transformOrigin: `${(p.x + q.x) / 2}px ${(p.y + q.y) / 2}px` }}>
                  <circle cx={(p.x + q.x) / 2} cy={(p.y + q.y) / 2} r="7" fill="var(--surface)" stroke={ok ? "var(--ok)" : "var(--danger)"} strokeWidth="1.4" />
                  {ok ? (
                    <path d={`M${(p.x + q.x) / 2 - 3} ${(p.y + q.y) / 2} l2 2.5 l4 -5`} fill="none" stroke="var(--ok)" strokeWidth="1.6" strokeLinecap="round" />
                  ) : (
                    <path d={`M${(p.x + q.x) / 2 - 3} ${(p.y + q.y) / 2 - 3} l6 6 M${(p.x + q.x) / 2 + 3} ${(p.y + q.y) / 2 - 3} l-6 6`} stroke="var(--danger)" strokeWidth="1.5" strokeLinecap="round" />
                  )}
                </motion.g>
              )}
            </g>
          );
        })}
        {nodes.map((p, i) => (
          <motion.rect
            key={i}
            x={p.x - 9} y={p.y - 9} width="18" height="18" rx="2"
            fill="var(--surface)" stroke="var(--text)" strokeWidth="1.5"
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: drawn ? 1 : 0.15, scale: drawn ? 1 : 0.6 }}
            transition={{ delay: drawn ? 0.12 * i : 0, type: "spring", stiffness: 260 }}
            style={{ transformOrigin: `${p.x}px ${p.y}px` }}
          />
        ))}
        <text x="180" y="414" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9.5" fill="var(--muted)" letterSpacing="1.5">THE MAP</text>
      </svg>
      <div className="border-t border-line px-4 py-3.5">
        <p className="font-serif text-[22px] leading-tight text-text">{copy.title}</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{copy.now}</p>
        {copy.next && <p className="mt-2 font-mono text-[10.5px] tracking-wide text-faint uppercase">Next · {copy.next}</p>}
      </div>
    </div>
  );
}

/** Typical full map on Nemotron (measured 22 Oct): the target the clock is shown against. */
const TARGET_SECONDS = 180;

export function Progress({ job }: { job: JobView | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const log = job?.log ?? [];
  const last = (pred: (l: JobView["log"][number]) => boolean) => [...log].reverse().find(pred);
  const stateOf = (pred: (l: JobView["log"][number]) => boolean): AgentState => {
    const msgs = log.filter(pred);
    if (msgs.some((m) => m.phase === "done")) return "done";
    if (msgs.some((m) => m.phase === "error")) return "err";
    return msgs.length ? "run" : "todo";
  };
  const isVerifier = (l: JobView["log"][number]) => l.message.startsWith("Verifier");
  const scout = stateOf((l) => l.agent === "scout");
  const readers = readerCards(log, now);
  const readersState: AgentState = !readers.length ? "todo" : readers.every((r) => r.state !== "run") ? "done" : "run";
  const cartographer = stateOf((l) => l.agent === "cartographer");
  const verifier = stateOf(isVerifier);
  const scoutDone = last((l) => l.agent === "scout" && l.phase === "done");
  const cartDone = last((l) => l.agent === "cartographer" && l.phase === "done");
  const verDone = last((l) => isVerifier(l) && l.phase === "done");
  const elapsed = job ? Math.max(0, Math.round((now - Date.parse(job.startedAt)) / 1000)) : 0;
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const failed = job?.status === "error";
  const stage: SurveyStage =
    verifier === "done" || job?.status === "done" ? "done"
      : verifier === "run" ? "verifier"
        : cartographer !== "todo" ? "cartographer"
          : readers.length ? "readers"
            : "scout";

  return (
    <div className="mx-auto min-h-0 w-full max-w-[1180px] overflow-y-auto px-6 py-8">
      <motion.div {...fadeIn} className="flex flex-wrap items-end justify-between gap-4 border-b border-text pb-4">
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] tracking-[0.2em] text-accent uppercase">Live survey</p>
          <div className="mt-1 font-serif text-[34px] leading-tight text-text">Surveying {job?.repoName ?? "repository"}</div>
          <div className="text-[13px] text-muted">{failed ? "The survey stopped. The log below says why." : "A team of agents is reading the code. The map opens when they finish."}</div>
        </div>
        <div className="text-right">
          <div className="font-serif text-[40px] leading-none text-text tabular-nums">{clock(elapsed)}</div>
          <div className="mt-1 font-mono text-[10.5px] tracking-wide text-muted uppercase">usually about {clock(TARGET_SECONDS)}</div>
          <div className="mt-2 h-1.5 w-40 border border-text">
            <span className={cn("block h-full transition-all", elapsed > TARGET_SECONDS ? "bg-warn" : "bg-accent")} style={{ width: `${Math.min(100, (elapsed / TARGET_SECONDS) * 100)}%` }} />
          </div>
        </div>
      </motion.div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
      <div className="relative space-y-3">
        <AgentCard
          Icon={Compass} name="Scout" role="Reads the tree and manifests, names the components, divides the work" state={scout}
          detail={(scoutDone ?? last((l) => l.agent === "scout"))?.message.replace(/^Scout · /, "")}
        />

        <div className={cn("rounded-[4px] border border-dashed px-3 py-3", readersState === "run" ? "border-accent/50" : "border-line")}>
          <div className="mb-2.5 flex items-center justify-between px-1">
            <span className="flex items-center gap-2 font-mono text-[11px] tracking-[0.12em] text-text uppercase">
              <BookOpen size={14} className="text-muted" /> Readers · in parallel
            </span>
            <span className="font-mono text-[11px] text-muted">
              {readers.filter((r) => r.state !== "run").length} / {readers[0]?.total ?? "…"} finished{readers.length && readers[0].total > readers.length ? ` · ${readers[0].total - readers.length} queued` : ""}
            </span>
          </div>
          {readers.length === 0 ? (
            <div className="px-1 pb-1 text-[12.5px] text-faint">Waiting for the Scout to divide the code.</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {readers.map((r) => (
                <motion.div key={r.name} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  className={cn("rounded-[3px] border bg-surface px-3 py-2.5", r.state === "run" ? "border-accent/60" : r.state === "err" ? "border-danger/50" : "border-line")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[11.5px] font-medium text-text">{r.name}</span>
                    {r.state === "run" ? <Spinner size={12} className="text-accent" /> : r.state === "done" ? <CircleCheck size={13} className="text-ok" /> : <span className="text-[11px] text-danger">failed</span>}
                  </div>
                  <div className="mt-1 text-[11.5px] text-muted">
                    {r.state === "run" ? `reading ${r.files}` : r.result}
                    {r.seconds !== null ? <span className="font-mono"> · {r.seconds}s</span> : null}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <AgentCard
            Icon={MapIcon} name="Cartographer" role="Joins everything into one map and its request flows" state={cartographer}
            detail={cartDone?.message.replace(/^Cartographer · /, "") ?? (cartographer === "run" ? last((l) => l.agent === "cartographer")?.message.replace(/^Cartographer · /, "") : undefined)}
          />
          <AgentCard
            Icon={ShieldCheck} name="Verifier" role="Checks every citation against the code" state={verifier}
            detail={verDone?.message.replace(/^Verifier · /, "").replace(/dropped \(evidence not found in code\)/, "rejected: their citation didn't match the code") ?? (verifier === "run" ? "checking citations…" : undefined)}
          />
        </div>
      </div>

      <div className="mt-6 rounded-[4px] border border-line-strong bg-surface">
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <span className="font-mono text-[10.5px] tracking-[0.2em] text-muted uppercase">Field log</span>
          {job?.status === "running" && <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-accent uppercase"><span className="cg-live-dot size-1.5 rounded-full bg-accent" /> live</span>}
        </div>
        <div className="max-h-[220px] overflow-y-auto px-4 py-2.5 font-mono text-[11.5px] leading-[1.8]">
          {log.slice(-40).map((l, i) => (
            <div key={`${l.at}-${i}`} className={cn("flex gap-3", l.phase === "error" ? "text-danger" : l.phase === "done" ? "text-text" : "text-muted")}>
              <span className="w-12 shrink-0 text-faint tabular-nums">{job ? clock(Math.max(0, Math.round((Date.parse(l.at) - Date.parse(job.startedAt)) / 1000))) : ""}</span>
              <span className="w-[92px] shrink-0 text-accent">{l.agent === "pipeline" ? (isVerifier(l) ? "verifier" : "cartograph") : l.agent}</span>
              <span className="min-w-0 break-words">{l.message}</span>
            </div>
          ))}
        </div>
      </div>
      {job?.error && <div className="mt-3 rounded-[4px] border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{job.error}</div>}
      </div>
      <div className="lg:sticky lg:top-4">
        <SurveyAnimation stage={stage} lanes={readers[0]?.total ?? readers.length} finished={readers.filter((r) => r.state !== "run").length} />
      </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- home

export function Home(props: {
  repos: RepoSummary[];
  /** The repo whose map is open behind this picker, if any. */
  current?: string | null;
  onOpen: (key: string) => void;
  onMap: (repo: string) => Promise<void>;
  onBack?: () => void;
  error: string | null;
}) {
  const { repos, current, onOpen, error } = props;
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto min-h-0 w-full max-w-[640px] overflow-y-auto px-6 py-10">
      {props.onBack && (
        <Button variant="ghost" size="sm" onClick={props.onBack} className="-mt-5 mb-5 -ml-2.5">
          <ArrowLeft size={14} /> Back to the map
        </Button>
      )}
      <motion.div {...fadeIn}>
        <CartographLogo size={44} />
        <h1 className="mt-4 mb-1.5 font-serif text-[44px] leading-[1.02] font-normal text-text">Map any codebase. Know <em className="text-accent">why</em> every line exists.</h1>
        <p className="m-0 max-w-[520px] text-[14px] leading-relaxed text-muted">
          Paste a GitHub repo. Cartograph's agents read the code and draw its architecture, and every dependency is cited from a real line of code.
        </p>
        <form
          className="mt-6 flex gap-2 rounded-2xl border border-line bg-surface p-1.5 shadow-card focus-within:border-accent/50 focus-within:ring-4 focus-within:ring-accent/10"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!value.trim() || busy) return;
            setBusy(true);
            try {
              await props.onMap(value.trim());
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="grid w-9 place-items-center text-faint">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
            </svg>
          </span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="github.com/owner/repo"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-faint"
          />
          <Button type="submit" variant="primary" disabled={!value.trim() || busy}>
            {busy ? <Spinner size={13} /> : null}
            Map repository
            {busy ? null : <ArrowRight size={14} />}
          </Button>
        </form>
        {error && <div className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div>}

        <div className="mt-6 grid grid-cols-3 gap-2">
          {[
            [ShieldCheck, "Cited, not guessed", "Every arrow links to file:line"],
            [Play, "Watch requests flow", "Hop by hop through real code"],
            [GitCommitHorizontal, "Drift on every push", "Reviewed in about a minute"],
          ].map(([Icon, t, d]) => {
            const I = Icon as typeof ShieldCheck;
            return (
              <div key={t as string} className="rounded-xl border border-line bg-surface-2/50 px-3 py-2.5">
                <I size={15} className="text-accent" />
                <div className="mt-1.5 text-[12.5px] font-semibold text-text">{t as string}</div>
                <div className="text-[11.5px] text-muted">{d as string}</div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {repos.length > 0 && (
        <motion.div {...fadeIn} transition={{ ...fadeIn.transition, delay: 0.08 }} className="mt-8">
          <Eyebrow>Mapped repositories</Eyebrow>
          <div className="flex flex-col gap-2">
            {repos.map((r) => (
              <button key={r.key} onClick={() => onOpen(r.key)} className="group flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 text-left shadow-card transition-all hover:-translate-y-px hover:border-accent/40 hover:shadow-pop">
                <CartographLogo size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-text">{r.name}</span>
                  <span className="block text-[11.5px] text-muted">
                    {r.mapping && !r.sha ? "First map in progress" : `${r.components} components · ${r.dependencies} dependencies`}
                    {r.sha ? <span className="font-mono"> · {shortSha(r.sha)}</span> : null}
                  </span>
                </span>
                {r.mapping ? (
                  <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-accent">
                    <Spinner size={12} /> mapping
                  </span>
                ) : r.key === current ? (
                  <span className="rounded-full bg-accent-soft px-2 py-[2px] text-[10.5px] font-semibold text-accent">Open</span>
                ) : (
                  <ArrowRight size={15} className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                )}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
