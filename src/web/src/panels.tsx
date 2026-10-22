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

const STAGES = [
  { id: "scout", label: "Scout", desc: "Plans the work", Icon: Compass },
  { id: "reader", label: "Readers", desc: "Read the code", Icon: BookOpen },
  { id: "cartographer", label: "Cartographer", desc: "Draws the map", Icon: MapIcon },
  { id: "verifier", label: "Verifier", desc: "Checks every citation", Icon: ShieldCheck },
] as const;

export function Progress({ job }: { job: JobView | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const log = job?.log ?? [];
  const state = (id: string): "todo" | "run" | "done" | "err" => {
    const msgs = log.filter((l) => (id === "verifier" ? l.message.startsWith("Verifier") : l.agent === id));
    if (msgs.some((m) => m.phase === "error") && !msgs.some((m) => m.phase === "done")) return "err";
    if (id === "reader") {
      const started = msgs.filter((m) => m.phase === "start").length;
      const done = msgs.filter((m) => m.phase === "done" || m.phase === "error").length;
      if (!started) return "todo";
      return done >= started && log.some((l) => l.agent === "cartographer") ? "done" : "run";
    }
    if (msgs.some((m) => m.phase === "done")) return "done";
    return msgs.length ? "run" : "todo";
  };
  const readers = log.filter((l) => l.agent === "reader" && l.phase === "start").length;
  const readersDone = log.filter((l) => l.agent === "reader" && (l.phase === "done" || l.phase === "error")).length;
  const elapsed = job ? Math.max(0, Math.round((now - Date.parse(job.startedAt)) / 1000)) : 0;
  const mm = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  return (
    <div className="mx-auto min-h-0 w-full max-w-[760px] overflow-y-auto px-6 py-8">
      <motion.div {...fadeIn} className="mb-6 flex items-center gap-3.5">
        <CartographLogo size={40} />
        <div className="min-w-0 flex-1">
          <div className="font-serif text-[26px] leading-tight font-normal text-text">Surveying {job?.repoName ?? "repository"}</div>
          <div className="text-[12.5px] text-muted">{job?.status === "error" ? "Mapping failed" : "A team of agents is reading the code"}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface px-2.5 py-1 font-mono text-[13px] text-text tabular-nums shadow-card">{mm}</div>
      </motion.div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {STAGES.map((s, i) => {
          const st = state(s.id);
          return (
            <motion.div key={s.id} {...fadeIn} transition={{ ...fadeIn.transition, delay: i * 0.05 }}>
              <Card className={cn("relative h-full px-3.5 py-3 transition-all", st === "run" && "border-accent/50 ring-4 ring-accent/10", st === "err" && "border-danger/40")}>
                <div className="flex items-center justify-between">
                  <span className={cn("grid size-8 place-items-center rounded-lg", st === "done" ? "bg-ok/12 text-ok" : st === "run" ? "bg-accent-soft text-accent" : "bg-surface-2 text-faint")}>
                    <s.Icon size={16} />
                  </span>
                  {st === "done" ? <CircleCheck size={16} className="text-ok" /> : st === "run" ? <Spinner className="text-accent" /> : null}
                </div>
                <div className="mt-2.5 text-[13px] font-semibold text-text">{s.label}</div>
                <div className="text-[11.5px] text-muted">{s.id === "reader" && readers ? `${readersDone} of ${readers} done` : s.desc}</div>
                {s.id === "reader" && readers > 0 && (
                  <div className="mt-2 flex gap-1">
                    {Array.from({ length: readers }, (_, r) => (
                      <span key={r} className={cn("h-1 flex-1 rounded-full transition-colors", r < readersDone ? "bg-ok" : "bg-accent/25")} />
                    ))}
                  </div>
                )}
              </Card>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-line bg-[#0f0f12] shadow-card">
        <div className="flex items-center gap-1.5 border-b border-white/5 px-3.5 py-2">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-2 font-mono text-[11px] text-white/40">agents · live</span>
        </div>
        <div className="min-h-[200px] px-3.5 py-3 font-mono text-[11.5px] leading-[1.75]">
          {log.slice(-14).map((l, i) => (
            <motion.div key={`${l.at}-${i}`} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className={cn("flex gap-3", l.phase === "error" ? "text-[#ff8a8a]" : l.phase === "done" ? "text-white/90" : "text-white/55")}>
              <span className="w-[86px] shrink-0 text-[#a99bff]">{l.agent === "pipeline" ? "cartograph" : l.agent}</span>
              <span className="min-w-0 break-words">{l.message}</span>
            </motion.div>
          ))}
          {job?.status === "running" && <span className="cg-caret text-[#a99bff]">▍</span>}
        </div>
      </div>
      {job?.error && <div className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{job.error}</div>}
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
