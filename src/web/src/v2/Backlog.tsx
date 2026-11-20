// Backlog: one epic per feature, stories citing the real code. A person
// approves, edits or rejects each one; only approved work is exported.
import { Check, ChevronDown, ChevronRight, Download, Pencil, Plus, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Card, Eyebrow, cn } from "../ui";
import { type Epic, type Story, api } from "./api";
import { ByBadge, Empty, StatusPill } from "./parts";
import type { ProjectContext } from "./V2App";

function useBacklogOp(ctx: ProjectContext) {
  return async (body: Record<string, unknown>, done?: string) => {
    try {
      await api(`/projects/${ctx.repoKey}/backlog`, { body });
      await ctx.reload();
      if (done) ctx.toast(done);
      return true;
    } catch (e) {
      ctx.toast((e as Error).message, true);
      return false;
    }
  };
}
type Op = ReturnType<typeof useBacklogOp>;

export function Backlog({ ctx }: { ctx: ProjectContext }) {
  const p = ctx.data.project;
  const op = useBacklogOp(ctx);
  const [mode, setMode] = useState(p.settings.mode);
  const [target, setTarget] = useState(p.settings.target);
  const features = useMemo(() => p.domains.flatMap((d) => d.features.filter((f) => !f.outOfScope).map((f) => ({ d, f }))), [p.domains]);
  const pending = features.filter(({ f }) => !p.epics.some((e) => e.featureId === f.id));
  const stories = p.epics.flatMap((e) => e.stories);
  const approved = stories.filter((s) => s.status === "approved").length;

  if (!p.approval) {
    return (
      <Empty title="Approve the feature tree first" action={<Button variant="primary" onClick={() => ctx.goTab("features")}>Go to features</Button>}>
        Stories are only written against a tree a person has signed off, with every entry point placed. That way no functionality is missing from the backlog.
      </Empty>
    );
  }

  const saveSettings = async () => {
    try {
      await api(`/projects/${ctx.repoKey}/settings`, { body: { mode, target } });
      await ctx.reload();
    } catch (e) {
      ctx.toast((e as Error).message, true);
    }
  };
  const settingsChanged = mode !== p.settings.mode || target !== p.settings.target;
  const exportHref = (fmt: "csv" | "md") => `api/v2/projects/${encodeURIComponent(ctx.repoKey)}/export.${fmt}`;

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card className="p-4">
          <Eyebrow>What the stories describe</Eyebrow>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Story mode">
            {([["as-is", "Document and extend", "Stories describe the application as built, ready to refine or extend."], ["migrate", "Rebuild on a new stack", "Stories describe rebuilding each feature on the target you name."]] as const).map(([m, label, hint]) => (
              <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                className={cn("min-w-[220px] flex-1 rounded-[4px] border p-2.5 text-left", mode === m ? "border-text bg-surface-2" : "border-line hover:border-line-strong")}>
                <div className="text-[13px] font-medium text-text">{label}</div>
                <div className="mt-0.5 text-[11.5px] text-muted">{hint}</div>
              </button>
            ))}
          </div>
          {mode === "migrate" && (
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Target, e.g. Next.js 15 storefront on the SAP Commerce OCC REST API" aria-label="Migration target"
              className="mt-2.5 h-9 w-full rounded-[4px] border border-line-strong bg-bg px-2.5 text-[12.5px] outline-none focus:border-text" />
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {settingsChanged && <Button size="sm" onClick={() => void saveSettings()}>Save</Button>}
            {pending.length > 0 && (
              <Button variant="primary" size="sm" disabled={ctx.busy || (mode === "migrate" && !target.trim())}
                onClick={async () => { if (settingsChanged) await saveSettings(); void ctx.runJob(`/projects/${ctx.repoKey}/stories`, { all: true, mode, target }); }}>
                <Sparkles size={13} /> Write stories for {pending.length} {pending.length === 1 ? "feature" : "features"}
              </Button>
            )}
          </div>
        </Card>
        <Card className="p-4">
          <Eyebrow>Export</Eyebrow>
          <div className="font-mono text-[22px] font-medium text-text">{approved}<span className="text-[13px] text-muted"> / {stories.length} stories approved</span></div>
          <p className="mt-1 mb-3 text-[11.5px] leading-relaxed text-muted">The CSV imports into Jira (External system import: map Issue Id, Parent Id, Issue Type, Summary, Description, Labels, Story Points). Only approved epics and stories are included.</p>
          <div className="flex gap-2">
            <a href={exportHref("csv")} download className={cn("inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-3 text-[12.5px] font-medium shadow-card hover:bg-surface-2", !approved && "pointer-events-none opacity-50")} aria-disabled={!approved}><Download size={13} /> Jira CSV</a>
            <a href={exportHref("md")} download className={cn("inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-3 text-[12.5px] font-medium shadow-card hover:bg-surface-2", !approved && "pointer-events-none opacity-50")} aria-disabled={!approved}><Download size={13} /> Markdown</a>
          </div>
        </Card>
      </div>

      {p.epics.length === 0 ? (
        <Empty title="No epics yet">Write stories for every feature at once above, or one feature at a time from the Features tab.</Empty>
      ) : (
        <div className="mt-6 space-y-4">
          {p.domains.map((d) => {
            const epics = p.epics.filter((e) => e.domainId === d.id);
            if (!epics.length) return null;
            return (
              <section key={d.id}>
                <h2 className="m-0 mb-2 border-b border-text pb-1.5 font-serif text-[22px] font-normal text-text">{d.name}</h2>
                <div className="space-y-3">{epics.map((e) => <EpicCard key={e.id} epic={e} ctx={ctx} op={op} />)}</div>
              </section>
            );
          })}
          {p.epics.filter((e) => !p.domains.some((d) => d.id === e.domainId)).map((e) => <EpicCard key={e.id} epic={e} ctx={ctx} op={op} />)}
        </div>
      )}
      {pending.length > 0 && p.epics.length > 0 && (
        <section className="mt-6">
          <Eyebrow>Features without an epic</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {pending.map(({ f }) => <Button key={f.id} size="sm" disabled={ctx.busy} onClick={() => void ctx.runJob(`/projects/${ctx.repoKey}/stories`, { featureIds: [f.id] })}><Sparkles size={12} /> {f.name}</Button>)}
          </div>
        </section>
      )}
    </div>
  );
}

function EpicCard({ epic, ctx, op }: { epic: Epic; ctx: ProjectContext; op: Op }) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(epic.title);
  const [description, setDescription] = useState(epic.description);
  const [confirm, setConfirm] = useState<"delete" | "redo" | null>(null);
  const [adding, setAdding] = useState(false);
  const counts = { approved: 0, rejected: 0, draft: 0 };
  for (const s of epic.stories) counts[s.status]++;
  const titles = new Map(epic.stories.map((s) => [s.id, s.title]));
  return (
    <Card className={cn("overflow-hidden", epic.status === "rejected" && "opacity-60")}>
      <div className="flex items-start gap-2 border-b border-line bg-surface-2/50 px-3 py-2.5">
        <button onClick={() => setOpen((o) => !o)} aria-label={open ? "Collapse" : "Expand"} className="mt-0.5 text-faint hover:text-text">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={async (e) => { e.preventDefault(); if (await op({ op: "edit-epic", epicId: epic.id, title, description })) setEditing(false); }} className="space-y-1.5">
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Epic title" className="h-8 w-full rounded-[3px] border border-text bg-bg px-2 text-[14px] font-semibold outline-none" />
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} aria-label="Epic description" className="w-full rounded-[3px] border border-line-strong bg-bg px-2 py-1 text-[12.5px] outline-none focus:border-text" />
              <div className="flex gap-1.5"><Button size="sm" variant="primary" type="submit">Save</Button><Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>Cancel</Button></div>
            </form>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wide text-accent">Epic</span>
                <h3 className="m-0 text-[15px] font-semibold text-text">{epic.title}</h3>
                <StatusPill status={epic.status} />
                <ByBadge by={epic.by} />
                {epic.mode === "migrate" && <span className="font-mono text-[10px] text-faint">→ {epic.target}</span>}
              </div>
              {epic.description && <p className="mt-1 mb-0 whitespace-pre-line text-[12.5px] leading-relaxed text-muted">{epic.description}</p>}
              <div className="mt-1 font-mono text-[10.5px] text-faint">{epic.stories.length} stories · {counts.approved} approved · {counts.draft} draft · {counts.rejected} rejected</div>
              {epic.notes?.map((n, i) => <div key={i} className="mt-1 text-[11.5px] text-warn">{n}</div>)}
            </>
          )}
        </div>
        {!editing && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            {confirm ? (
              <span className="flex items-center gap-1 text-[12px] text-muted">
                {confirm === "delete" ? "Delete this epic?" : "Rewrite, replacing these stories?"}
                <Button size="sm" variant="danger" onClick={() => { setConfirm(null); if (confirm === "delete") void op({ op: "delete-epic", epicId: epic.id }, "Epic deleted"); else void ctx.runJob(`/projects/${ctx.repoKey}/stories`, { featureIds: [epic.featureId], replace: true }); }}>Yes</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>No</Button>
              </span>
            ) : (
              <>
                {counts.draft > 0 && <Button size="sm" variant="primary" onClick={() => void op({ op: "approve-all", epicId: epic.id }, `Approved ${epic.title}`)}><Check size={13} /> Approve all</Button>}
                {epic.status !== "approved" && counts.draft === 0 && <Button size="sm" onClick={() => void op({ op: "set-epic", epicId: epic.id, status: "approved" })}><Check size={13} /> Approve epic</Button>}
                {epic.status !== "rejected" ? <Button size="sm" variant="ghost" onClick={() => void op({ op: "set-epic", epicId: epic.id, status: "rejected" })}>Reject</Button> : <Button size="sm" variant="ghost" onClick={() => void op({ op: "set-epic", epicId: epic.id, status: "draft" })}>Reopen</Button>}
                <button aria-label="Edit epic" title="Edit epic" onClick={() => { setTitle(epic.title); setDescription(epic.description); setEditing(true); }} className="grid size-7 place-items-center rounded-[4px] text-muted hover:bg-surface-2 hover:text-text"><Pencil size={13} /></button>
                <button aria-label="Rewrite stories" title="Rewrite stories" disabled={ctx.busy} onClick={() => setConfirm("redo")} className="grid size-7 place-items-center rounded-[4px] text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"><RotateCcw size={13} /></button>
                <button aria-label="Delete epic" title="Delete epic" onClick={() => setConfirm("delete")} className="grid size-7 place-items-center rounded-[4px] text-muted hover:bg-danger/[0.06] hover:text-danger"><Trash2 size={13} /></button>
              </>
            )}
          </div>
        )}
      </div>
      {open && (
        <div className="divide-y divide-line">
          {epic.stories.map((s, i) => <StoryRow key={s.id} n={i + 1} story={s} epic={epic} ctx={ctx} op={op} titles={titles} />)}
          <div className="px-3 py-2">
            {adding ? <AddStory onCancel={() => setAdding(false)} onAdd={async (title, userStory) => { if (await op({ op: "add-story", epicId: epic.id, title, userStory })) setAdding(false); }} /> : <Button size="sm" variant="ghost" onClick={() => setAdding(true)}><Plus size={13} /> Add a story</Button>}
          </div>
        </div>
      )}
    </Card>
  );
}

function StoryRow({ n, story: s, epic, ctx, op, titles }: { n: number; story: Story; epic: Epic; ctx: ProjectContext; op: Op; titles: Map<string, string> }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: s.title, userStory: s.userStory, technical: s.technical, acceptance: s.acceptance.join("\n"), size: s.size });
  const notes = ctx.data.project.entries;
  const set = (status: "approved" | "rejected" | "draft") => void op({ op: "set-story", epicId: epic.id, storyId: s.id, status });
  if (editing) {
    return (
      <form className="space-y-2 bg-surface-2/40 px-3 py-3" onSubmit={async (e) => {
        e.preventDefault();
        if (await op({ op: "edit-story", epicId: epic.id, storyId: s.id, ...draft, acceptance: draft.acceptance.split("\n").map((a) => a.trim()).filter(Boolean) })) setEditing(false);
      }}>
        <input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Story title" className="h-8 w-full rounded-[3px] border border-text bg-bg px-2 text-[13px] font-medium outline-none" />
        {([["userStory", "User story", 2], ["technical", "Technical notes", 5], ["acceptance", "Acceptance criteria, one per line", 4]] as const).map(([k, label, rows]) => (
          <label key={k} className="block">
            <span className="font-mono text-[10px] uppercase tracking-wide text-faint">{label}</span>
            <textarea rows={rows} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} className="mt-0.5 w-full rounded-[3px] border border-line-strong bg-bg px-2 py-1 font-sans text-[12.5px] outline-none focus:border-text" />
          </label>
        ))}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-faint">Size</span>
          {(["S", "M", "L"] as const).map((z) => <button key={z} type="button" aria-pressed={draft.size === z} onClick={() => setDraft({ ...draft, size: z })} className={cn("h-7 w-8 rounded-[3px] border font-mono text-[12px]", draft.size === z ? "border-text bg-text text-bg" : "border-line")}>{z}</button>)}
          <span className="flex-1" />
          <Button size="sm" variant="primary" type="submit">Save</Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </form>
    );
  }
  return (
    <div className={cn("px-3 py-2", s.status === "rejected" && "opacity-55")}>
      <div className="flex items-start gap-2">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          <span className="mt-0.5 w-5 shrink-0 font-mono text-[10.5px] text-faint">{n}</span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className={cn("text-[13px] font-medium text-text", s.status === "rejected" && "line-through")}>{s.title}</span>
              <span className="rounded-[3px] border border-line px-1 font-mono text-[9.5px] text-muted" title="Size">{s.size}</span>
              <StatusPill status={s.status} />
              {s.by !== "agent" && <ByBadge by={s.by} />}
            </span>
            {!open && s.userStory && <span className="mt-0.5 block truncate text-[12px] text-muted">{s.userStory}</span>}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {s.status !== "approved" && <button aria-label="Approve story" title="Approve" onClick={() => set("approved")} className="grid size-7 place-items-center rounded-[4px] text-ok hover:bg-ok/10"><Check size={14} /></button>}
          {s.status !== "rejected" && <button aria-label="Reject story" title="Reject" onClick={() => set("rejected")} className="grid size-7 place-items-center rounded-[4px] text-muted hover:bg-danger/[0.06] hover:text-danger"><X size={14} /></button>}
          {s.status !== "draft" && <button aria-label="Back to draft" title="Back to draft" onClick={() => set("draft")} className="grid size-7 place-items-center rounded-[4px] text-muted hover:bg-surface-2"><RotateCcw size={13} /></button>}
          <button aria-label="Edit story" title="Edit" onClick={() => { setDraft({ title: s.title, userStory: s.userStory, technical: s.technical, acceptance: s.acceptance.join("\n"), size: s.size }); setEditing(true); }} className="grid size-7 place-items-center rounded-[4px] text-muted hover:bg-surface-2 hover:text-text"><Pencil size={13} /></button>
          <button aria-label="Delete story" title="Delete" onClick={() => void op({ op: "delete-story", epicId: epic.id, storyId: s.id })} className="grid size-7 place-items-center rounded-[4px] text-muted hover:bg-danger/[0.06] hover:text-danger"><Trash2 size={13} /></button>
        </div>
      </div>
      {open && (
        <div className="mt-2 space-y-3 pl-7 text-[12.5px] leading-relaxed">
          {s.userStory && <p className="m-0 text-text">{s.userStory}</p>}
          {s.technical && <div><Eyebrow className="mb-1">Technical notes</Eyebrow><p className="m-0 whitespace-pre-line text-muted">{s.technical}</p></div>}
          {s.acceptance.length > 0 && (
            <div><Eyebrow className="mb-1">Acceptance criteria</Eyebrow>
              <ul className="m-0 space-y-0.5 pl-4 text-text">{s.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          )}
          {s.dependsOn.length > 0 && <div className="text-[12px] text-muted">Depends on: {s.dependsOn.map((d) => titles.get(d) ?? d).join(", ")}</div>}
          {(s.entries.length > 0 || s.elements.length > 0) && (
            <div>
              <Eyebrow className="mb-1">Code it cites</Eyebrow>
              <div className="flex flex-wrap gap-1">
                {s.entries.map((id) => <button key={id} onClick={() => ctx.openElement(id)} className="rounded-[3px] border border-accent/40 bg-accent-soft px-1.5 py-[1px] text-[11.5px] text-text hover:border-accent">{notes[id]?.title ?? id.split("#").pop()}</button>)}
                {s.elements.filter((id) => !s.entries.includes(id)).map((id) => <button key={id} title={id} onClick={() => ctx.openElement(id)} className="rounded-[3px] border border-line bg-surface px-1.5 py-[1px] font-mono text-[11px] text-muted hover:border-text hover:text-text">{shortName(id)}</button>)}
              </div>
            </div>
          )}
          {s.notes?.map((n, i) => <div key={i} className="text-[11.5px] text-warn">{n}</div>)}
        </div>
      )}
    </div>
  );
}

/** "java:com.acme.CartFacade#getCart" → "CartFacade.getCart"; paths → file name. */
function shortName(id: string): string {
  const body = id.slice(id.indexOf(":") + 1);
  const [owner, member] = body.split("#");
  if (owner.includes("/")) return `${owner.split("/").pop()}${member ? `#${member}` : ""}`;
  const cls = owner.split(".").pop() ?? owner;
  return member ? `${cls}.${member}` : cls;
}

function AddStory({ onAdd, onCancel }: { onAdd: (title: string, userStory: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [userStory, setUserStory] = useState("");
  return (
    <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); if (title.trim()) onAdd(title.trim(), userStory.trim()); }}>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Story title" aria-label="Story title" className="h-8 w-full rounded-[3px] border border-text bg-bg px-2 text-[13px] outline-none" />
      <textarea value={userStory} onChange={(e) => setUserStory(e.target.value)} rows={2} placeholder="As a …, I want …, so that …" aria-label="User story" className="w-full rounded-[3px] border border-line-strong bg-bg px-2 py-1 text-[12.5px] outline-none focus:border-text" />
      <div className="flex gap-1.5"><Button size="sm" variant="primary" type="submit" disabled={!title.trim()}>Add</Button><Button size="sm" variant="ghost" type="button" onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}
