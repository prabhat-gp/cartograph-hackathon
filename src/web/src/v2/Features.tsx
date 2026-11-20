// Features: the tree the agents propose and a person fixes, and the gate.
// Stories can only be written once every entry point sits in a feature and
// someone has approved the tree.
import { Check, ChevronDown, ChevronRight, CircleAlert, Info, MoreHorizontal, Plus, ShieldCheck, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Card, Eyebrow, cn } from "../ui";
import { type Domain, type EntryIndexRow, type Feature, api } from "./api";
import { ByBadge, Empty, KindBadge } from "./parts";
import type { ProjectContext } from "./V2App";

function useTreeOps(ctx: ProjectContext) {
  return async (body: Record<string, unknown>, done?: string) => {
    try {
      await api(`/projects/${ctx.repoKey}/tree`, { body });
      await ctx.reload();
      if (done) ctx.toast(done);
      return true;
    } catch (e) {
      ctx.toast((e as Error).message, true);
      return false;
    }
  };
}

/** Text that turns into an input on click; Enter saves, Escape cancels. */
function Editable({ value, onSave, className, multiline, placeholder, label }: { value: string; onSave: (v: string) => void; className?: string; multiline?: boolean; placeholder?: string; label: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing) {
    return (
      <button onClick={() => { setDraft(value); setEditing(true); }} className={cn("rounded-[3px] text-left hover:bg-surface-2 hover:outline hover:outline-1 hover:outline-line", className)} title={`Edit ${label}`}>
        {value || <span className="text-faint">{placeholder}</span>}
      </button>
    );
  }
  const save = () => {
    setEditing(false);
    if (draft.trim() !== value) onSave(draft.trim());
  };
  const props = {
    autoFocus: true, value: draft, "aria-label": label,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: save,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") setEditing(false);
      if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) save();
    },
    className: cn("w-full rounded-[3px] border border-text bg-bg px-1.5 py-0.5 text-text outline-none", className),
  };
  return multiline ? <textarea rows={3} {...props} /> : <input {...props} />;
}

export function Features({ ctx }: { ctx: ProjectContext }) {
  const { project: p, coverage: cov, entryIndex } = ctx.data;
  const op = useTreeOps(ctx);
  const index = useMemo(() => new Map(entryIndex.map((e) => [e.id, e])), [entryIndex]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const clear = () => setSelected(new Set());
  const features = p.domains.flatMap((d) => d.features.map((f) => ({ domain: d, feature: f })));
  const epicFor = (fid: string) => p.epics.find((e) => e.featureId === fid);

  if (!cov || cov.total === 0) {
    return <Empty title="No entry points found">The parsers found no endpoints, routes, cronjobs, processes or listeners in this repository. Check the Inventory's unread files: the code may be in a language Cartograph doesn't read yet.</Empty>;
  }
  if (p.domains.length === 0) {
    return (
      <Empty title="Let the agents propose a feature tree" action={<Button variant="primary" disabled={ctx.busy} onClick={() => void ctx.runJob(`/projects/${ctx.repoKey}/analyze`, {})}><Sparkles size={14} /> Analyze with agents</Button>}>
        The inventory found {cov.total.toLocaleString()} entry points. A Scout names the business domains, Readers describe each entry point from its code, a Cartographer groups them into features, and a Reviewer flags anything that looks wrong. Nothing is final until you approve it.
      </Empty>
    );
  }

  const pct = (n: number) => `${(n / cov.total) * 100}%`;
  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-6 pb-28">
      {p.summary && <p className="mt-0 mb-5 max-w-[760px] font-serif text-[19px] leading-snug text-text">{p.summary}</p>}
      <Card className="p-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-[260px] flex-1">
            <Eyebrow>Completeness gate</Eyebrow>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[22px] font-medium text-text">{cov.assigned.toLocaleString()}</span>
              <span className="text-[13px] text-muted">of {cov.total.toLocaleString()} entry points placed in a feature</span>
            </div>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden>
              <div className="bg-ok" style={{ width: pct(cov.inScope) }} />
              <div className="bg-line-strong" style={{ width: pct(cov.outOfScope) }} />
              <div className="bg-accent" style={{ width: pct(cov.unassigned.length) }} />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-ok" /> {cov.inScope} in scope</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-line-strong" /> {cov.outOfScope} out of scope</span>
              <span className={cn("flex items-center gap-1.5", cov.unassigned.length && "font-medium text-accent")}><span className="size-2 rounded-full bg-accent" /> {cov.unassigned.length} not placed</span>
              {cov.duplicated.length > 0 && <span className="text-danger">{cov.duplicated.length} in two features</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {cov.unassigned.length > 0 && <Button disabled={ctx.busy} onClick={() => void ctx.runJob(`/projects/${ctx.repoKey}/analyze`, {})}><Sparkles size={14} /> Place new entry points</Button>}
            {confirmRebuild ? (
              <span className="flex items-center gap-1.5 text-[12px] text-muted">
                Replace the whole tree, edits included?
                <Button size="sm" variant="danger" onClick={() => { setConfirmRebuild(false); void ctx.runJob(`/projects/${ctx.repoKey}/analyze`, { full: true }); }}>Rebuild</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRebuild(false)}>Cancel</Button>
              </span>
            ) : <Button variant="ghost" size="sm" disabled={ctx.busy} onClick={() => setConfirmRebuild(true)}>Rebuild tree</Button>}
            {p.approval ? (
              <span className="flex items-center gap-2 rounded-[4px] border border-ok/40 bg-ok/[0.07] px-3 py-2 text-[12.5px] text-ok">
                <ShieldCheck size={15} /> Approved {new Date(p.approval.at).toLocaleDateString()}
                <Button size="sm" variant="primary" onClick={() => ctx.goTab("backlog")}>Go to backlog</Button>
              </span>
            ) : (
              <Button variant="primary" disabled={!cov.complete || ctx.busy} title={cov.complete ? "Sign off the tree so stories can be written" : "Place every entry point in a feature first"}
                onClick={async () => {
                  try {
                    await api(`/projects/${ctx.repoKey}/approve`, { body: {} });
                    await ctx.reload();
                    ctx.toast("Tree approved. Stories can be written now.");
                  } catch (e) {
                    ctx.toast((e as Error).message, true);
                  }
                }}>
                <Check size={14} /> Approve tree
              </Button>
            )}
          </div>
        </div>
      </Card>

      {p.notes.length > 0 && (
        <section className="mt-5">
          <Eyebrow>Reviewer notes</Eyebrow>
          <ul className="m-0 list-none space-y-1.5 p-0">
            {p.notes.map((n) => {
              const f = features.find((x) => x.feature.id === n.featureId)?.feature;
              return (
                <li key={n.id} className={cn("flex items-start gap-2.5 rounded-[4px] border px-3 py-2 text-[12.5px]", n.severity === "warning" ? "border-warn/40 bg-warn/[0.06]" : "border-line bg-surface")}>
                  {n.severity === "warning" ? <CircleAlert size={14} className="mt-0.5 shrink-0 text-warn" /> : <Info size={14} className="mt-0.5 shrink-0 text-info" />}
                  <span className="min-w-0 flex-1 text-text">{f && <a href={`#${f.id}`} className="mr-1 font-medium underline decoration-line-strong underline-offset-2">{f.name}:</a>}{n.message}</span>
                  <ByBadge by={n.by} />
                  <button onClick={() => void op({ op: "dismiss-note", noteId: n.id })} aria-label="Dismiss note" className="shrink-0 text-faint hover:text-text"><X size={14} /></button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {cov.unassigned.length > 0 && (
        <section className="mt-5">
          <Card className="border-accent/50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[13px] font-semibold text-accent">Not in any feature · {cov.unassigned.length}</span>
              <span className="text-[12px] text-muted">Select them and move them into a feature, or run the agents to place them.</span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set(cov.unassigned))}>Select all</Button>
            </div>
            <EntryList ids={cov.unassigned.slice(0, 300)} index={index} ctx={ctx} selected={selected} onToggle={toggle} />
            {cov.unassigned.length > 300 && <div className="mt-1 text-[11.5px] text-faint">and {cov.unassigned.length - 300} more</div>}
          </Card>
        </section>
      )}

      <div className="mt-6 space-y-6">
        {p.domains.map((d) => <DomainSection key={d.id} domain={d} ctx={ctx} op={op} index={index} selected={selected} onToggle={toggle} domains={p.domains} epicFor={epicFor} />)}
      </div>
      <NewDomain op={op} />

      {selected.size > 0 && <SelectionBar ctx={ctx} op={op} selected={[...selected]} onClear={clear} features={features} index={index} />}
    </div>
  );
}

function EntryList({ ids, index, ctx, selected, onToggle }: { ids: string[]; index: Map<string, EntryIndexRow>; ctx: ProjectContext; selected: Set<string>; onToggle: (id: string) => void }) {
  const notes = ctx.data.project.entries;
  return (
    <ul className="m-0 list-none p-0">
      {ids.map((id) => {
        const row = index.get(id);
        const note = notes[id];
        return (
          <li key={id} className={cn("group flex items-center gap-2 rounded-[3px] px-1.5 py-1", selected.has(id) && "bg-accent-soft")}>
            <input type="checkbox" checked={selected.has(id)} onChange={() => onToggle(id)} aria-label={`Select ${note?.title ?? row?.name ?? id}`} className="size-3.5 shrink-0 accent-[var(--accent)]" />
            <KindBadge kind={row?.kind ?? "method"} className="w-[74px] justify-center" />
            <button onClick={() => ctx.openElement(id)} className="min-w-0 flex-1 truncate text-left text-[12.5px] text-text hover:underline" title={note?.summary ?? row?.name}>
              {note?.title ?? row?.name ?? id}
              {note?.by === "rule" && <span className="ml-1.5 font-mono text-[9.5px] uppercase text-warn">rule</span>}
            </button>
            {row?.http && <span className="max-w-[38%] shrink-0 truncate font-mono text-[10.5px] text-faint">{row.http}</span>}
          </li>
        );
      })}
    </ul>
  );
}

type Op = ReturnType<typeof useTreeOps>;

function DomainSection({ domain, ctx, op, index, selected, onToggle, domains, epicFor }: { domain: Domain; ctx: ProjectContext; op: Op; index: Map<string, EntryIndexRow>; selected: Set<string>; onToggle: (id: string) => void; domains: Domain[]; epicFor: (fid: string) => { stories: unknown[]; status: string } | undefined }) {
  const total = domain.features.reduce((n, f) => n + f.entryIds.length, 0);
  return (
    <section aria-label={domain.name}>
      <div className="mb-2 flex items-baseline gap-3 border-b border-text pb-1.5">
        <Editable value={domain.name} label="domain name" className="font-serif text-[22px] text-text" onSave={(name) => void op({ op: "rename-domain", domainId: domain.id, name })} />
        <span className="font-mono text-[11px] text-faint">{domain.features.length} features · {total} entry points</span>
        {domain.features.length === 0 && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void op({ op: "delete-domain", domainId: domain.id })}>Delete domain</Button>}
      </div>
      <Editable value={domain.description} label="domain description" placeholder="Add a description" className="mb-3 block text-[12.5px] text-muted" onSave={(description) => void op({ op: "rename-domain", domainId: domain.id, name: domain.name, description })} />
      <div className="grid gap-3 lg:grid-cols-2">
        {domain.features.map((f) => <FeatureCard key={f.id} f={f} domain={domain} ctx={ctx} op={op} index={index} selected={selected} onToggle={onToggle} domains={domains} epic={epicFor(f.id)} />)}
        <NewFeature domain={domain} op={op} />
      </div>
    </section>
  );
}

function FeatureCard({ f, domain, ctx, op, index, selected, onToggle, domains, epic }: { f: Feature; domain: Domain; ctx: ProjectContext; op: Op; index: Map<string, EntryIndexRow>; selected: Set<string>; onToggle: (id: string) => void; domains: Domain[]; epic?: { stories: unknown[]; status: string } }) {
  const [open, setOpen] = useState(f.entryIds.length <= 8);
  const [menu, setMenu] = useState(false);
  const others = domains.flatMap((d) => d.features).filter((x) => x.id !== f.id);
  const approved = !!ctx.data.project.approval;
  return (
    <Card className={cn("p-3", f.outOfScope && "opacity-60")}>
      <div id={f.id} className="flex items-start gap-2">
        <button onClick={() => setOpen((o) => !o)} aria-label={open ? "Collapse" : "Expand"} className="mt-0.5 text-faint hover:text-text">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Editable value={f.name} label="feature name" className="text-[14px] font-semibold text-text" onSave={(name) => void op({ op: "rename-feature", featureId: f.id, name })} />
            <ByBadge by={f.by} />
            {f.outOfScope && <span className="font-mono text-[10px] uppercase tracking-wide text-faint">out of scope</span>}
            <span className="font-mono text-[10.5px] text-faint">{f.entryIds.length}</span>
          </div>
          <Editable value={f.description} label="feature description" placeholder="Add a description" multiline className="mt-0.5 block text-[12px] leading-relaxed text-muted" onSave={(description) => void op({ op: "rename-feature", featureId: f.id, name: f.name, description })} />
        </div>
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)} aria-label="Feature actions" aria-expanded={menu} className="grid size-7 place-items-center rounded-[4px] text-muted hover:bg-surface-2 hover:text-text"><MoreHorizontal size={15} /></button>
          {menu && (
            <div className="absolute right-0 z-20 mt-1 w-[240px] rounded-[4px] border border-text bg-surface p-1.5 shadow-pop" onMouseLeave={() => setMenu(false)}>
              <button className="w-full rounded-[3px] px-2 py-1.5 text-left text-[12.5px] hover:bg-surface-2" onClick={() => { setMenu(false); void op({ op: "set-scope", featureId: f.id, outOfScope: !f.outOfScope }); }}>{f.outOfScope ? "Bring back in scope" : "Mark out of scope"}</button>
              <label className="block px-2 pt-1.5 font-mono text-[10px] uppercase tracking-wide text-faint">Merge into</label>
              <select className="mt-1 w-full rounded-[3px] border border-line bg-bg px-1.5 py-1 text-[12px]" value="" onChange={(e) => { setMenu(false); if (e.target.value) void op({ op: "merge-features", featureIds: [f.id], intoId: e.target.value }, `Merged into ${others.find((o) => o.id === e.target.value)?.name}`); }}>
                <option value="">Choose a feature…</option>
                {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              {domains.length > 1 && (
                <>
                  <label className="block px-2 pt-2 font-mono text-[10px] uppercase tracking-wide text-faint">Move to domain</label>
                  <select className="mt-1 w-full rounded-[3px] border border-line bg-bg px-1.5 py-1 text-[12px]" value="" onChange={(e) => { setMenu(false); if (e.target.value) void op({ op: "move-feature", featureId: f.id, toDomainId: e.target.value }); }}>
                    <option value="">Choose a domain…</option>
                    {domains.filter((d) => d.id !== domain.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </>
              )}
              <button className="mt-1.5 w-full rounded-[3px] px-2 py-1.5 text-left text-[12.5px] text-danger hover:bg-danger/[0.06]" onClick={() => { setMenu(false); void op({ op: "delete-feature", featureId: f.id }, "Feature removed; its entry points are unassigned"); }}>Delete feature</button>
            </div>
          )}
        </div>
      </div>
      {open && <div className="mt-2 border-t border-line pt-2"><EntryList ids={f.entryIds} index={index} ctx={ctx} selected={selected} onToggle={onToggle} /></div>}
      {!f.outOfScope && (
        <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
          {epic ? (
            <button onClick={() => ctx.goTab("backlog")} className="text-[12px] text-muted hover:text-text">Epic · {epic.stories.length} stories · <span className="uppercase">{epic.status}</span> →</button>
          ) : approved ? (
            <Button size="sm" variant="secondary" disabled={ctx.busy} onClick={() => void ctx.runJob(`/projects/${ctx.repoKey}/stories`, { featureIds: [f.id] })}><Sparkles size={13} /> Write stories</Button>
          ) : (
            <span className="text-[11.5px] text-faint">Stories open up once the tree is approved.</span>
          )}
        </div>
      )}
    </Card>
  );
}

function NewFeature({ domain, op }: { domain: Domain; op: Op }) {
  const [name, setName] = useState<string | null>(null);
  if (name === null) return <button onClick={() => setName("")} className="flex min-h-[64px] items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-line-strong text-[12.5px] text-muted hover:border-text hover:text-text"><Plus size={14} /> New feature in {domain.name}</button>;
  return (
    <form className="flex items-center gap-2 rounded-[6px] border border-text p-3" onSubmit={async (e) => { e.preventDefault(); if (name.trim() && (await op({ op: "new-feature", domainId: domain.id, name }))) setName(null); }}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Feature name" aria-label="New feature name" className="h-8 min-w-0 flex-1 rounded-[3px] border border-line bg-bg px-2 text-[13px] outline-none focus:border-text" />
      <Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>Add</Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setName(null)}>Cancel</Button>
    </form>
  );
}

function NewDomain({ op }: { op: Op }) {
  const [name, setName] = useState<string | null>(null);
  return (
    <div className="mt-6">
      {name === null ? <Button size="sm" variant="ghost" onClick={() => setName("")}><Plus size={14} /> New domain</Button> : (
        <form className="flex max-w-[420px] items-center gap-2" onSubmit={async (e) => { e.preventDefault(); if (name.trim() && (await op({ op: "new-domain", name }))) setName(null); }}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Domain name" aria-label="New domain name" className="h-8 min-w-0 flex-1 rounded-[3px] border border-line bg-bg px-2 text-[13px] outline-none focus:border-text" />
          <Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>Add</Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setName(null)}>Cancel</Button>
        </form>
      )}
    </div>
  );
}

function SelectionBar({ op, selected, onClear, features }: { ctx: ProjectContext; op: Op; selected: string[]; onClear: () => void; features: { domain: Domain; feature: Feature }[]; index: Map<string, EntryIndexRow> }) {
  const [name, setName] = useState("");
  const owner = features.find((x) => x.feature.entryIds.includes(selected[0]));
  const domainId = owner?.domain.id ?? features[0]?.domain.id;
  const allFromOne = owner && selected.every((id) => owner.feature.entryIds.includes(id)) && selected.length < owner.feature.entryIds.length;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-text bg-surface px-4 py-2.5 shadow-pop">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium text-text">{selected.length} selected</span>
        <select className="h-8 rounded-[4px] border border-line-strong bg-bg px-2 text-[12.5px]" value="" aria-label="Move selected to feature"
          onChange={async (e) => { if (e.target.value && (await op({ op: "move-entries", entryIds: selected, toFeatureId: e.target.value }, "Moved"))) onClear(); }}>
          <option value="">Move to feature…</option>
          {features.map(({ domain, feature }) => <option key={feature.id} value={feature.id}>{domain.name} › {feature.name}</option>)}
        </select>
        <form className="flex items-center gap-1.5" onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || !domainId) return;
          const ok = allFromOne
            ? await op({ op: "split-feature", featureId: owner!.feature.id, name, entryIds: selected }, `Split off ${name}`)
            : await op({ op: "new-feature", domainId, name, entryIds: selected }, `Created ${name}`);
          if (ok) { setName(""); onClear(); }
        }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={allFromOne ? "Split into a new feature…" : "New feature from these…"} aria-label="New feature name" className="h-8 w-[220px] rounded-[4px] border border-line-strong bg-bg px-2 text-[12.5px] outline-none focus:border-text" />
          <Button size="sm" type="submit" disabled={!name.trim()}>{allFromOne ? "Split" : "Create"}</Button>
        </form>
        <Button size="sm" variant="ghost" onClick={async () => { if (await op({ op: "unassign-entries", entryIds: selected }, "Unassigned")) onClear(); }}>Unassign</Button>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>Clear</Button>
      </div>
    </div>
  );
}
