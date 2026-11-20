// Small V2 building blocks: kind labels and colours, author and status badges,
// the job progress strip, and the element drawer every tab opens.
import { ArrowDownLeft, ArrowUpRight, FileCode2, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cn, Spinner } from "../ui";
import { type ElementKind, type ElementPayload, type V2Job, api, enc } from "./api";

type Tone = "entry" | "web" | "logic" | "data" | "view" | "cms" | "wiring" | "ui";

const KIND: Record<ElementKind, { label: string; tone: Tone }> = {
  endpoint: { label: "Endpoint", tone: "entry" }, route: { label: "Route", tone: "entry" }, cronjob: { label: "Cronjob", tone: "entry" },
  "business-process": { label: "Process", tone: "entry" }, "event-listener": { label: "Listener", tone: "entry" },
  controller: { label: "Controller", tone: "web" }, "cms-controller": { label: "CMS controller", tone: "web" }, interceptor: { label: "Interceptor", tone: "web" },
  facade: { label: "Facade", tone: "logic" }, service: { label: "Service", tone: "logic" }, populator: { label: "Populator", tone: "logic" },
  converter: { label: "Converter", tone: "logic" }, job: { label: "Job", tone: "logic" }, "process-action": { label: "Process action", tone: "logic" },
  method: { label: "Method", tone: "logic" }, class: { label: "Class", tone: "logic" }, interface: { label: "Interface", tone: "logic" },
  dao: { label: "DAO", tone: "data" }, model: { label: "Model", tone: "data" }, "item-type": { label: "Item type", tone: "data" },
  "jsp-page": { label: "Page", tone: "view" }, "jsp-tag": { label: "Tag", tone: "view" },
  "cms-page": { label: "CMS page", tone: "cms" }, "cms-template": { label: "CMS template", tone: "cms" }, "cms-slot": { label: "CMS slot", tone: "cms" }, "cms-component": { label: "CMS component", tone: "cms" },
  bean: { label: "Bean", tone: "wiring" }, config: { label: "Config", tone: "wiring" }, extension: { label: "Extension", tone: "wiring" },
  component: { label: "Component", tone: "ui" }, hook: { label: "Hook", tone: "ui" }, function: { label: "Function", tone: "ui" }, store: { label: "Store", tone: "ui" }, "api-call": { label: "API call", tone: "ui" },
};

const TONE: Record<Tone, string> = {
  entry: "bg-accent/12 text-accent",
  web: "bg-[#2c5878]/12 text-[#2c5878] dark:text-[#7fa9cf]",
  logic: "bg-[#7a4e8a]/12 text-[#7a4e8a] dark:text-[#c79bd6]",
  data: "bg-[#2f5d46]/12 text-[#2f5d46] dark:text-[#6fb38d]",
  view: "bg-[#8a5a2b]/12 text-[#8a5a2b] dark:text-[#d6a473]",
  cms: "bg-[#2c6e6e]/12 text-[#2c6e6e] dark:text-[#7cc2c2]",
  wiring: "bg-surface-3 text-muted",
  ui: "bg-[#b07a1e]/12 text-[#b07a1e] dark:text-[#e0a84a]",
};

export const kindLabel = (k: string) => KIND[k as ElementKind]?.label ?? k;

export function KindBadge({ kind, className }: { kind: string; className?: string }) {
  const k = KIND[kind as ElementKind];
  return <span className={cn("inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-[1px] font-mono text-[10px] font-medium uppercase tracking-wide", TONE[k?.tone ?? "wiring"], className)}>{k?.label ?? kind}</span>;
}

/** Who made it: an agent, a rule (an agent didn't answer), or a person. */
export function ByBadge({ by }: { by: "agent" | "rule" | "human" }) {
  const label = by === "agent" ? "Agent" : by === "rule" ? "Rule · check" : "Edited";
  const cls = by === "agent" ? "border-line text-faint" : by === "rule" ? "border-warn/40 text-warn" : "border-ok/40 text-ok";
  return <span className={cn("inline-flex shrink-0 items-center rounded-[3px] border px-1.5 py-[1px] font-mono text-[9.5px] uppercase tracking-wide", cls)} title={by === "rule" ? "An agent didn't place or write this; Cartograph filled it in by rule. Check it." : undefined}>{label}</span>;
}

export function StatusPill({ status }: { status: "draft" | "approved" | "rejected" }) {
  const cls = status === "approved" ? "bg-ok/12 text-ok" : status === "rejected" ? "bg-danger/10 text-danger line-through" : "bg-surface-3 text-muted";
  return <span className={cn("inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-[1px] font-mono text-[10px] font-medium uppercase tracking-wide", cls)}>{status}</span>;
}

/** Polls a job until it ends; shows the latest lines while it runs. */
export function useJob(jobId: string | null, onDone: (job: V2Job) => void): V2Job | null {
  const [job, setJob] = useState<V2Job | null>(null);
  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const j = await api<V2Job>(`/jobs/${jobId}`);
        if (stop) return;
        setJob(j);
        if (j.status !== "running") {
          onDone(j);
          return;
        }
      } catch {
        /* a blip: try again */
      }
      if (!stop) timer = setTimeout(tick, 1200);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);
  return job;
}

const JOB_LABEL = { scan: "Scanning the code", analyze: "Agents are building the feature tree", stories: "The Story Writer is drafting" } as const;

export function JobStrip({ job }: { job: V2Job | null }) {
  if (!job) return null;
  const last = job.log.slice(-4);
  return (
    <div className={cn("border-b px-4 py-2.5", job.status === "error" ? "border-danger/30 bg-danger/[0.05]" : "border-line bg-surface-2")} role="status" aria-live="polite">
      <div className="mx-auto flex max-w-[1180px] items-start gap-3">
        {job.status === "running" ? <Spinner className="mt-0.5 shrink-0 text-accent" /> : <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", job.status === "done" ? "bg-ok" : "bg-danger")} />}
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-text">{job.status === "error" ? `Failed: ${job.error}` : JOB_LABEL[job.kind]}{job.status === "running" ? "…" : job.status === "done" ? " · done" : ""}</div>
          <div className="mt-0.5 space-y-0.5 font-mono text-[11px] text-muted">
            {last.map((l, i) => <div key={i} className="truncate">{l.message}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto max-w-[520px] py-16 text-center">
      <h2 className="m-0 font-serif text-[26px] font-normal text-text">{title}</h2>
      {children && <p className="mx-auto mt-2 mb-0 max-w-[440px] text-[13.5px] leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

const LINK_WORD: Record<string, [string, string]> = {
  calls: ["Calls", "Called by"], injects: ["Injects", "Injected into"], implements: ["Implements", "Implemented by"], extends: ["Extends", "Extended by"],
  defines: ["Defines", "Defined by"], renders: ["Renders", "Rendered by"], includes: ["Includes", "Included by"], uses: ["Uses", "Used by"],
  places: ["Places", "Placed by"], populates: ["Populates with", "Populates"], http: ["Calls over HTTP", "Called over HTTP by"], requires: ["Requires", "Required by"],
  runs: ["Runs", "Run by"], contains: ["Contains", "Inside"],
};

/** Right-hand drawer with one element: facts, code, links in and out, and its slice. */
export function ElementDrawer({ repoKey, id, onOpen, onClose }: { repoKey: string; id: string; onOpen: (id: string) => void; onClose: () => void }) {
  const [data, setData] = useState<ElementPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    setError(null);
    api<ElementPayload>(`/projects/${repoKey}/elements/${enc(id)}`).then(setData, (e: Error) => setError(e.message));
  }, [repoKey, id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const el = data?.element;
  const group = <T extends { kind: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const l of list) if (l.kind !== "contains" || list.length < 40) m.set(l.kind, [...(m.get(l.kind) ?? []), l]);
    return [...m];
  };
  return (
    <aside className="fixed inset-y-0 right-0 z-50 flex w-[min(560px,100vw)] flex-col border-l border-text bg-surface shadow-pop" aria-label="Element details">
      <div className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          {el ? (
            <>
              <div className="flex items-center gap-2"><KindBadge kind={el.kind} />{data?.entry !== undefined && <span className="font-mono text-[10px] uppercase tracking-wide text-accent">entry point</span>}</div>
              <h3 className="mt-1.5 mb-0 break-words text-[16px] font-semibold text-text">{data?.entry?.title ?? el.name}</h3>
              {data?.entry?.title && <div className="mt-0.5 font-mono text-[11.5px] text-muted">{el.name}</div>}
              <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-faint"><FileCode2 size={12} /> <span className="truncate">{el.file}:{el.line}</span></div>
            </>
          ) : error ? <div className="text-[13px] text-danger">{error}</div> : <Spinner />}
        </div>
        <button onClick={onClose} aria-label="Close" className="grid size-8 shrink-0 place-items-center rounded-[4px] text-muted hover:bg-surface-2 hover:text-text"><X size={16} /></button>
      </div>
      {el && data && (
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {data.entry?.summary && <p className="m-0 text-[13px] leading-relaxed text-text">{data.entry.summary}</p>}
          {el.meta && Object.keys(el.meta).length > 0 && (
            <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
              {Object.entries(el.meta).filter(([k]) => !["ctor"].includes(k)).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="font-mono text-[10.5px] uppercase tracking-wide text-faint">{k}</dt>
                  <dd className="m-0 break-words font-mono text-[11.5px] text-text">{Array.isArray(v) ? v.join(", ") : v}</dd>
                </div>
              ))}
            </dl>
          )}
          {data.slice && data.slice.length > 1 && (
            <section>
              <h4 className="m-0 mb-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">What it reaches · {data.slice.length - 1} elements</h4>
              <ol className="m-0 list-none space-y-0.5 p-0">
                {data.slice.slice(1).map((s) => (
                  <li key={s.id} style={{ paddingLeft: Math.min(s.depth - 1, 6) * 14 }}>
                    <button onClick={() => onOpen(s.id)} className="flex w-full min-w-0 items-center gap-2 rounded-[3px] px-1.5 py-1 text-left hover:bg-surface-2">
                      <span className="w-14 shrink-0 font-mono text-[10px] text-faint">{s.via}</span>
                      <KindBadge kind={s.element.kind} />
                      <span className="truncate text-[12px] text-text">{s.element.name}</span>
                      {s.entry && <span className="shrink-0 font-mono text-[9.5px] uppercase text-accent">entry</span>}
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {data.code && (
            <section>
              <h4 className="m-0 mb-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">Code</h4>
              <pre className="m-0 max-h-[360px] overflow-auto rounded-[4px] border border-line bg-code px-3 py-2 font-mono text-[11px] leading-relaxed text-text">{data.code}</pre>
            </section>
          )}
          {([{ dir: "out", list: data.outgoing }, { dir: "in", list: data.incoming }] as { dir: "out" | "in"; list: (ElementPayload["incoming"][number] | ElementPayload["outgoing"][number])[] }[]).map(({ dir, list }) => list.length > 0 && (
            <section key={dir}>
              {group(list).map(([kind, links]) => (
                <div key={kind} className="mb-3">
                  <h4 className="m-0 mb-1.5 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
                    {dir === "out" ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />} {(LINK_WORD[kind] ?? [kind, kind])[dir === "out" ? 0 : 1]} · {links.length}
                  </h4>
                  <ul className="m-0 list-none space-y-0.5 p-0">
                    {links.slice(0, 40).map((l, i) => {
                      const other = "target" in l ? l.target : l.source;
                      return (
                        <li key={`${other.id}-${i}`}>
                          <button onClick={() => onOpen(other.id)} className="flex w-full min-w-0 items-center gap-2 rounded-[3px] px-1.5 py-1 text-left hover:bg-surface-2" title={`${l.file}:${l.line}`}>
                            <KindBadge kind={other.kind} />
                            <span className="truncate text-[12px] text-text">{other.name}</span>
                            <span className="ml-auto shrink-0 font-mono text-[10px] text-faint">{l.file.split("/").pop()}:{l.line}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}
