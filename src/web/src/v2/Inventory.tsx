// Inventory: everything the parsers found, with no model involved. Filter by
// view (all, entry points, not reached, unread files) and by kind; open any
// element to see its code, its links and, for an entry point, its slice.
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, Eyebrow, Spinner, cn } from "../ui";
import { type ElementsPage, type FilesPage, api } from "./api";
import { KindBadge, kindLabel } from "./parts";
import type { ProjectContext } from "./V2App";

type View = "all" | "entries" | "unreached" | "unread";

export function Inventory({ ctx }: { ctx: ProjectContext }) {
  const stats = ctx.data.summary.stats;
  const [view, setView] = useState<View>("entries");
  const [kind, setKind] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<ElementsPage | null>(null);
  const [files, setFiles] = useState<FilesPage | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    setLoading(true);
    if (view === "unread") {
      api<FilesPage>(`/projects/${ctx.repoKey}/files?status=unread`).then(setFiles).catch(() => setFiles(null)).finally(() => setLoading(false));
      return;
    }
    const params = new URLSearchParams({ limit: "200" });
    if (view !== "all") params.set("view", view);
    if (kind) params.set("kind", kind);
    if (query) params.set("q", query);
    api<ElementsPage>(`/projects/${ctx.repoKey}/elements?${params}`).then(setPage).catch(() => setPage(null)).finally(() => setLoading(false));
  }, [ctx.repoKey, view, kind, query, ctx.data.project.sha]);
  const more = async () => {
    if (!page) return;
    const params = new URLSearchParams({ limit: "200", offset: String(page.elements.length) });
    if (view !== "all") params.set("view", view);
    if (kind) params.set("kind", kind);
    if (query) params.set("q", query);
    const next = await api<ElementsPage>(`/projects/${ctx.repoKey}/elements?${params}`);
    setPage({ ...next, elements: [...page.elements, ...next.elements] });
  };
  const kinds = useMemo(() => Object.entries(stats?.byKind ?? {}).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)), [stats]);
  const notes = ctx.data.project.entries;
  if (!stats) return <div className="p-8 text-muted">No inventory yet. Rescan the repository.</div>;

  const views: { id: View; label: string; count: number; hint: string }[] = [
    { id: "entries", label: "Entry points", count: stats.entryPoints, hint: "Endpoints, routes, cronjobs, processes and listeners: where functionality starts." },
    { id: "all", label: "Everything", count: stats.elements, hint: "Every element the parsers found." },
    { id: "unreached", label: "Not reached", count: ctx.data.unreached, hint: "Behaviour no entry point reaches: dead code, or wiring the parsers can't see yet." },
    { id: "unread", label: "Unread files", count: stats.unreadFiles, hint: "Code no parser reads yet. Listed so nothing is silently skipped." },
  ];
  return (
    <div className="mx-auto flex w-full max-w-[1180px] gap-6 px-4 py-6 max-md:flex-col">
      <aside className="w-[230px] shrink-0 max-md:w-full">
        <Card className="p-3">
          <Eyebrow>Found in {ctx.data.project.sha.slice(0, 7)}</Eyebrow>
          <div className="grid grid-cols-2 gap-2 text-center">
            {[["elements", stats.elements], ["links", stats.links], ["files", stats.parsedFiles], ["unread", stats.unreadFiles]].map(([label, n]) => (
              <div key={label} className="rounded-[4px] bg-surface-2 py-1.5">
                <div className="font-mono text-[15px] font-medium text-text">{Number(n).toLocaleString()}</div>
                <div className="font-mono text-[9.5px] uppercase tracking-wide text-faint">{label}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1">{ctx.data.project.stack.map((s) => <span key={s} className="rounded-[3px] bg-surface-3 px-1.5 py-[1px] font-mono text-[10px] text-muted">{s}</span>)}</div>
        </Card>
        <nav className="mt-4 space-y-0.5" aria-label="Inventory views">
          {views.map((v) => (
            <button key={v.id} onClick={() => { setView(v.id); setKind(null); }} title={v.hint}
              className={cn("flex w-full items-center justify-between rounded-[4px] px-2.5 py-1.5 text-left text-[13px]", view === v.id ? "bg-text text-bg" : "text-text hover:bg-surface-2")}>
              {v.label}<span className={cn("font-mono text-[11px]", view === v.id ? "text-bg/70" : "text-faint")}>{v.count.toLocaleString()}</span>
            </button>
          ))}
        </nav>
        {view !== "unread" && (
          <div className="mt-5">
            <Eyebrow>Kinds</Eyebrow>
            <div className="flex flex-wrap gap-1">
              {kinds.map(([k, n]) => (
                <button key={k} onClick={() => setKind(kind === k ? null : k)} aria-pressed={kind === k}
                  className={cn("flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[11.5px]", kind === k ? "border-text bg-surface" : "border-transparent hover:border-line")}>
                  <KindBadge kind={k} /> <span className="font-mono text-[10.5px] text-faint">{n}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      <section className="min-w-0 flex-1">
        {view === "unread" ? (
          <Card>
            <div className="border-b border-line px-4 py-3">
              <h2 className="m-0 text-[15px] font-semibold">Unread files</h2>
              <p className="mt-1 mb-0 text-[12.5px] text-muted">Code no parser understands yet (for example Velocity email templates, Kotlin or Angular templates), or files over the size limit. They are not in any entry point's slice, so check whether they hold functionality.</p>
            </div>
            {loading ? <div className="p-4"><Spinner /></div> : (
              <ul className="m-0 max-h-[70vh] list-none overflow-y-auto p-0">
                {files?.files.map((f) => (
                  <li key={f.path} className="flex items-center gap-3 border-b border-line/60 px-4 py-1.5 last:border-0">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text">{f.path}</span>
                    {f.parser && <span className="shrink-0 text-[11px] text-faint">{f.parser}</span>}
                  </li>
                ))}
                {files && files.files.length === 0 && <li className="px-4 py-6 text-[13px] text-muted">Every file was read.</li>}
              </ul>
            )}
          </Card>
        ) : (
          <>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names, files, paths, beans…" aria-label="Search the inventory"
                className="h-10 w-full rounded-[4px] border border-line-strong bg-surface pr-3 pl-9 text-[13px] text-text outline-none placeholder:text-faint focus:border-text" />
            </div>
            <div className="mt-2 mb-2 flex items-center gap-2 font-mono text-[11px] text-faint">
              {loading ? <Spinner size={12} /> : <span>{page?.total.toLocaleString() ?? 0} {kind ? kindLabel(kind).toLowerCase() : view === "entries" ? "entry points" : "elements"}</span>}
            </div>
            <Card>
              <ul className="m-0 list-none p-0">
                {page?.elements.map((el) => {
                  const http = (el.meta?.http as string[] | undefined)?.[0] ?? (el.meta?.path as string | undefined) ?? (el.meta?.schedule as string | undefined);
                  const title = notes[el.id]?.title;
                  return (
                    <li key={el.id} className="border-b border-line/60 last:border-0">
                      <button onClick={() => ctx.openElement(el.id)} className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left hover:bg-surface-2">
                        <KindBadge kind={el.kind} className="w-[92px] justify-center" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-text">{title ?? el.name}</span>
                          <span className="block truncate font-mono text-[10.5px] text-faint">{title ? `${el.name} · ` : ""}{el.file}:{el.line}</span>
                        </span>
                        {http && <span className="max-w-[40%] shrink-0 truncate font-mono text-[11px] text-muted">{http}</span>}
                      </button>
                    </li>
                  );
                })}
                {page && page.elements.length === 0 && <li className="px-4 py-8 text-center text-[13px] text-muted">Nothing matches.</li>}
              </ul>
            </Card>
            {page && page.elements.length < page.total && <div className="mt-3 text-center"><Button size="sm" onClick={() => void more()}>Show more</Button></div>}
          </>
        )}
      </section>
    </div>
  );
}
