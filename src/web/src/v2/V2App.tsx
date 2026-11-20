// Cartograph V2: break an application into its functionality, then into a
// backlog a person approves. Four tabs per repository: Map (the V1 map),
// Inventory (everything the parsers found), Features (the tree and the
// completeness gate) and Backlog (epics and stories, review and export).
import { ArrowRight, ChevronsUpDown, Moon, RefreshCw, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Bridge } from "../bridge";
import { DeskHeader, GithubMark } from "../chrome";
import { Button, Card, Eyebrow, IconButton, Spinner, ago, cn } from "../ui";
import { type ProjectPayload, type ProjectSummary, api } from "./api";
import { Backlog } from "./Backlog";
import { Features } from "./Features";
import { Inventory } from "./Inventory";
import { MapTab } from "./MapTab";
import { ElementDrawer, JobStrip, useJob } from "./parts";

export type Tab = "map" | "inventory" | "features" | "backlog";
const TABS: { id: Tab; label: string }[] = [
  { id: "inventory", label: "Inventory" },
  { id: "features", label: "Features" },
  { id: "backlog", label: "Backlog" },
  { id: "map", label: "Map" },
];

function readRoute(): { key: string | null; tab: Tab } {
  const p = new URLSearchParams(location.search);
  const tab = p.get("tab") as Tab | null;
  return { key: p.get("repo"), tab: tab && TABS.some((t) => t.id === tab) ? tab : "features" };
}

function writeRoute(key: string | null, tab: Tab, replace = false) {
  const url = new URL(location.href);
  url.search = key ? `?v=2&repo=${encodeURIComponent(key)}&tab=${tab}` : "?v=2";
  history[replace ? "replaceState" : "pushState"](null, "", url);
}

function useTheme() {
  const [pref, setPref] = useState<"light" | "dark" | null>(() => {
    try {
      const v = localStorage.getItem("cartograph.theme");
      return v === "light" || v === "dark" ? v : null;
    } catch {
      return null;
    }
  });
  const system = () => (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const theme = pref ?? system();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.display = "fullscreen";
  }, [theme]);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setPref(next);
    try {
      localStorage.setItem("cartograph.theme", next);
    } catch {
      /* private window */
    }
  };
  return { dark: theme === "dark", toggle };
}

export function V2App({ bridge }: { bridge: Bridge }) {
  const [route, setRoute] = useState(readRoute);
  const theme = useTheme();
  useEffect(() => {
    void bridge.connect();
    const onPop = () => setRoute(readRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [bridge]);
  const go = useCallback((key: string | null, tab: Tab = "features") => {
    writeRoute(key, tab);
    setRoute({ key, tab });
  }, []);
  const themeButton = (
    <IconButton label="Toggle dark mode" onClick={theme.toggle}>
      {theme.dark ? <Sun size={15} /> : <Moon size={15} />}
    </IconButton>
  );
  return route.key ? (
    <ProjectView key={route.key} repoKey={route.key} tab={route.tab} bridge={bridge} onTab={(t) => go(route.key, t)} onHome={() => go(null)} themeButton={themeButton} />
  ) : (
    <div className="flex min-h-full flex-col bg-bg">
      <DeskHeader standalone version="v2" actions={themeButton} />
      <Home onOpen={(key) => go(key, "features")} />
    </div>
  );
}

// ---------------------------------------------------------------- home

const STEPS = [
  ["Inventory", "Parsers read every controller, facade, service, DAO, JSP, CMS item, cronjob, React route and component, with the file and line. No AI in this step, so nothing is guessed and nothing is skipped."],
  ["Features", "Agents describe each entry point in business terms and group them into domains and features. You fix the tree: rename, merge, split, move, or mark out of scope."],
  ["Gate", "The tree can only be approved when every entry point sits in a feature. Until then, no stories."],
  ["Backlog", "One click turns a feature into an epic and its stories, citing the real code. You approve, edit or reject each one, then export a Jira-ready CSV."],
];

function Home({ onOpen }: { onOpen: (key: string) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [value, setValue] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<{ projects: ProjectSummary[] }>("/projects").then((r) => setProjects(r.projects), (e: Error) => setError(e.message)), []);
  useEffect(() => void load(), [load]);
  const job = useJob(jobId, (j) => {
    if (j.status === "done" && pendingKey) onOpen(pendingKey);
    else if (j.status === "error") setError(j.error ?? "The scan failed");
    setJobId(null);
  });
  const scan = async () => {
    setError(null);
    try {
      const r = await api<{ jobId: string; key: string }>("/scan", { body: { repo: value.trim() } });
      setPendingKey(r.key);
      setJobId(r.jobId);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <main className="mx-auto w-full max-w-[920px] flex-1 px-6 py-10">
      <Eyebrow>Cartograph V2 · from code to backlog</Eyebrow>
      <h1 className="m-0 max-w-[680px] font-serif text-[40px] leading-[1.05] font-normal text-text">Break an application into its functionality, then into stories your team can approve.</h1>
      <ol className="mt-7 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(([title, text], i) => (
          <li key={title} className="rounded-[6px] border border-line bg-surface p-3.5">
            <div className="font-mono text-[10.5px] tracking-[0.14em] text-accent uppercase">{i + 1} · {title}</div>
            <p className="mt-1.5 mb-0 text-[12.5px] leading-relaxed text-muted">{text}</p>
          </li>
        ))}
      </ol>

      <Card className="mt-8 p-4">
        <form onSubmit={(e) => { e.preventDefault(); if (value.trim() && !jobId) void scan(); }} className="flex gap-2 max-sm:flex-col">
          <label className="sr-only" htmlFor="v2-repo">GitHub repository</label>
          <input id="v2-repo" value={value} onChange={(e) => setValue(e.target.value)} placeholder="github.com/owner/repo" autoComplete="off" spellCheck={false}
            className="h-10 min-w-0 flex-1 rounded-[4px] border border-line-strong bg-bg px-3 font-mono text-[13px] text-text outline-none placeholder:text-faint focus:border-text" />
          <Button variant="primary" type="submit" disabled={!value.trim() || !!jobId}>{jobId ? <><Spinner /> Scanning…</> : <>Scan <ArrowRight size={14} /></>}</Button>
        </form>
        {job && <div className="mt-3 font-mono text-[11.5px] text-muted">{job.log.at(-1)?.message ?? "Starting…"}</div>}
        {error && <div className="mt-3 text-[12.5px] text-danger">{error}</div>}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint">
          <span>Try:</span>
          {["spring-projects/spring-petclinic", "alan2207/bulletproof-react", "SAP-samples/cloud-commerce-sample-setup"].map((r) => (
            <button key={r} type="button" onClick={() => setValue(r)} className="font-mono text-[11.5px] text-muted underline decoration-line-strong underline-offset-2 hover:text-text">{r}</button>
          ))}
        </div>
      </Card>

      <section className="mt-9">
        <Eyebrow>Scanned repositories</Eyebrow>
        {!projects ? <Spinner /> : projects.length === 0 ? <p className="m-0 text-[13px] text-muted">None yet. Scan one above.</p> : (
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
            {projects.map((p) => {
              const c = p.coverage;
              const pct = c && c.total ? Math.round((c.assigned / c.total) * 100) : 0;
              return (
                <li key={p.key}>
                  <button onClick={() => onOpen(p.key)} className="w-full rounded-[6px] border border-line bg-surface p-4 text-left shadow-card transition-colors hover:border-text">
                    <div className="flex items-center gap-2">
                      {p.repo.source === "github" && <GithubMark size={13} className="text-faint" />}
                      <span className="truncate font-mono text-[13px] font-medium text-text">{p.repo.name}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10.5px] text-faint">{ago(p.scannedAt)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">{p.stack.slice(0, 5).map((s) => <span key={s} className="rounded-[3px] bg-surface-3 px-1.5 py-[1px] font-mono text-[10px] text-muted">{s}</span>)}</div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className={cn("h-full", p.approved ? "bg-ok" : "bg-accent")} style={{ width: `${pct}%` }} /></div>
                    <div className="mt-1.5 flex justify-between font-mono text-[10.5px] text-muted">
                      <span>{c ? `${c.assigned}/${c.total} entry points placed` : "Not analyzed"}</span>
                      <span>{p.approved ? "Tree approved" : ""}{p.epics ? ` · ${p.approvedStories} stories approved` : ""}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

// ---------------------------------------------------------------- one repository

export interface ProjectContext {
  repoKey: string;
  data: ProjectPayload;
  reload: () => Promise<void>;
  /** Start (or attach to) a job, then reload when it ends. */
  runJob: (path: string, body?: unknown) => Promise<void>;
  busy: boolean;
  openElement: (id: string) => void;
  toast: (message: string, error?: boolean) => void;
  goTab: (tab: Tab) => void;
}

function ProjectView({ repoKey, tab, bridge, onTab, onHome, themeButton }: { repoKey: string; tab: Tab; bridge: Bridge; onTab: (t: Tab) => void; onHome: () => void; themeButton: React.ReactNode }) {
  const [data, setData] = useState<ProjectPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const reload = useCallback(async () => {
    try {
      const d = await api<ProjectPayload>(`/projects/${repoKey}`);
      setData(d);
      if (d.summary.job) setJobId((j) => j ?? d.summary.job!);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [repoKey]);
  useEffect(() => void reload(), [reload]);
  const showToast = useCallback((message: string, err = false) => {
    setToast({ message, error: err });
    setTimeout(() => setToast((t) => (t?.message === message ? null : t)), 4500);
  }, []);
  const job = useJob(jobId, (j) => {
    void reload();
    if (j.status === "error") showToast(j.error ?? "The job failed", true);
    setTimeout(() => setJobId((id) => (id === j.id ? null : id)), 4000);
  });
  const runJob = useCallback(async (path: string, body: unknown = {}) => {
    try {
      const r = await api<{ jobId: string }>(path, { body });
      setJobId(r.jobId);
    } catch (e) {
      showToast((e as Error).message, true);
    }
  }, [showToast]);

  if (error && !data) {
    return (
      <div className="flex min-h-full flex-col bg-bg">
        <DeskHeader standalone version="v2" actions={themeButton} />
        <div className="mx-auto max-w-[520px] px-6 py-16">
          <h1 className="m-0 font-serif text-[28px] font-normal">Couldn't open this repository</h1>
          <p className="text-[13.5px] text-muted">{error}</p>
          <Button onClick={onHome}>All repositories</Button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="grid min-h-full place-items-center bg-bg text-muted"><span className="flex items-center gap-2 text-[13px]"><Spinner /> Opening…</span></div>;

  const p = data.project;
  const busy = job?.status === "running";
  const ctx: ProjectContext = { repoKey, data, reload, runJob, busy, openElement: setDrawer, toast: showToast, goTab: onTab };
  const counts: Partial<Record<Tab, string>> = {
    inventory: String(data.summary.stats?.entryPoints ?? ""),
    features: data.coverage ? `${data.coverage.assigned}/${data.coverage.total}` : "",
    backlog: p.epics.length ? String(p.epics.reduce((n, e) => n + e.stories.length, 0)) : "",
  };
  return (
    <div className="flex h-full flex-col bg-bg">
      <DeskHeader
        standalone
        version="v2"
        center={
          <nav className="flex items-center gap-5 max-md:gap-3" aria-label="V2 sections">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => onTab(t.id)} aria-current={tab === t.id ? "page" : undefined}
                className={cn("relative flex h-8 items-center gap-1.5 text-[14px] transition-colors", tab === t.id ? "text-text" : "text-muted hover:text-text")}>
                {t.label}
                {counts[t.id] && <span className="font-mono text-[10.5px] text-faint max-sm:hidden">{counts[t.id]}</span>}
                {tab === t.id && <span className="absolute inset-x-0 -bottom-[13px] h-[2px] bg-accent" />}
              </button>
            ))}
          </nav>
        }
        actions={
          <>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void runJob("/scan", { repo: p.repo.source === "github" ? p.repo.name : p.repo.location })} title="Read the latest commit again">
              <RefreshCw size={13} /> <span className="max-lg:hidden">Rescan</span>
            </Button>
            {themeButton}
          </>
        }
      >
        <span className="mx-1 h-5 w-px bg-line-strong max-sm:hidden" />
        <button onClick={onHome} title="All repositories" className="-mx-1 flex min-w-0 items-center gap-1.5 rounded-[4px] px-1.5 py-1 font-mono text-[12.5px] text-muted hover:bg-surface-2">
          {p.repo.source === "github" && <GithubMark size={13} className="shrink-0 text-faint" />}
          <span className="max-w-[220px] truncate font-medium text-text">{p.repo.name}</span>
          <ChevronsUpDown size={12} className="shrink-0 text-faint" />
        </button>
        <span className="rounded-[4px] border border-line px-1.5 py-[1px] font-mono text-[10.5px] text-muted max-md:hidden" title={`Scanned ${new Date(p.scannedAt).toLocaleString()}`}>{p.sha.slice(0, 7)}</span>
      </DeskHeader>
      <JobStrip job={job} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "inventory" && <Inventory ctx={ctx} />}
        {tab === "features" && <Features ctx={ctx} />}
        {tab === "backlog" && <Backlog ctx={ctx} />}
        {tab === "map" && <MapTab ctx={ctx} bridge={bridge} />}
      </div>
      {drawer && <ElementDrawer repoKey={repoKey} id={drawer} onOpen={setDrawer} onClose={() => setDrawer(null)} />}
      {toast && <div role="status" className={cn("fixed bottom-4 left-1/2 z-[60] max-w-[min(560px,calc(100vw-32px))] -translate-x-1/2 rounded-[4px] px-3 py-2 text-[12.5px] text-white shadow-pop", toast.error ? "bg-danger" : "bg-text text-bg")}>{toast.message}</div>}
    </div>
  );
}
