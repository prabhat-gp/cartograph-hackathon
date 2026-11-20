// What a person does in V2: edit the feature tree, approve it through the
// completeness gate, then review the backlog. Every change is validated here,
// recorded in the project's history, and an edit to an approved tree reopens
// the gate (stories are only written against a tree a human signed off).
import type { Inventory } from "./inventory/types";
import { type Domain, type Epic, type Feature, type Project, type Story, coverage, findFeature, log, newId } from "./project";

export class ReviewError extends Error {
  override name = "ReviewError";
}

const need = <T>(value: T | undefined | null, message: string): T => {
  if (value === undefined || value === null) throw new ReviewError(message);
  return value;
};
const text = (v: unknown, field: string, max = 4000): string => {
  if (typeof v !== "string" || !v.trim()) throw new ReviewError(`${field} is required`);
  return v.trim().slice(0, max);
};
const optText = (v: unknown, max = 8000): string | undefined => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
const ids = (v: unknown, field: string): string[] => {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new ReviewError(`${field} must be a list of ids`);
  return v as string[];
};

export type TreeOp =
  | { op: "rename-feature"; featureId: string; name: string; description?: string }
  | { op: "new-feature"; domainId: string; name: string; description?: string; entryIds?: string[] }
  | { op: "move-entries"; entryIds: string[]; toFeatureId: string }
  | { op: "unassign-entries"; entryIds: string[] }
  | { op: "merge-features"; featureIds: string[]; intoId: string }
  | { op: "split-feature"; featureId: string; name: string; entryIds: string[] }
  | { op: "set-scope"; featureId: string; outOfScope: boolean }
  | { op: "delete-feature"; featureId: string }
  | { op: "move-feature"; featureId: string; toDomainId: string }
  | { op: "new-domain"; name: string; description?: string }
  | { op: "rename-domain"; domainId: string; name: string; description?: string }
  | { op: "delete-domain"; domainId: string }
  | { op: "edit-entry"; entryId: string; title?: string; summary?: string }
  | { op: "dismiss-note"; noteId: string };

function detach(p: Project, entryIds: string[]): void {
  const set = new Set(entryIds);
  for (const d of p.domains) for (const f of d.features) f.entryIds = f.entryIds.filter((id) => !set.has(id));
}

export function applyTreeOp(p: Project, inv: Inventory, raw: TreeOp): string {
  const domain = (id: string): Domain => need(p.domains.find((d) => d.id === id), `no domain ${id}`);
  const feature = (id: string): { domain: Domain; feature: Feature } => need(findFeature(p, id), `no feature ${id}`);
  const known = new Set(inv.entryPoints);
  const entries = (v: unknown) => {
    const list = ids(v, "entryIds");
    const bad = list.filter((id) => !known.has(id));
    if (bad.length) throw new ReviewError(`not entry points of this repository: ${bad.slice(0, 3).join(", ")}`);
    return list;
  };
  let detail: string;
  switch (raw.op) {
    case "rename-feature": {
      const { feature: f } = feature(raw.featureId);
      const before = f.name;
      f.name = text(raw.name, "name", 120);
      if (raw.description !== undefined) f.description = optText(raw.description, 1000) ?? "";
      f.by = "human";
      detail = `${before} → ${f.name}`;
      break;
    }
    case "new-feature": {
      const d = domain(raw.domainId);
      const list = raw.entryIds ? entries(raw.entryIds) : [];
      detach(p, list);
      const f: Feature = { id: newId("f"), name: text(raw.name, "name", 120), description: optText(raw.description, 1000) ?? "", entryIds: list, by: "human" };
      d.features.push(f);
      detail = `${f.name} in ${d.name}`;
      break;
    }
    case "move-entries": {
      const list = entries(raw.entryIds);
      const { feature: f } = feature(raw.toFeatureId);
      detach(p, list);
      f.entryIds.push(...list);
      detail = `${list.length} entry point${list.length > 1 ? "s" : ""} → ${f.name}`;
      break;
    }
    case "unassign-entries": {
      const list = entries(raw.entryIds);
      detach(p, list);
      detail = `${list.length} entry point${list.length > 1 ? "s" : ""} unassigned`;
      break;
    }
    case "merge-features": {
      const into = feature(raw.intoId).feature;
      const others = ids(raw.featureIds, "featureIds").filter((id) => id !== into.id).map((id) => feature(id));
      if (!others.length) throw new ReviewError("pick at least one other feature to merge");
      for (const o of others) {
        into.entryIds.push(...o.feature.entryIds.filter((id) => !into.entryIds.includes(id)));
        o.domain.features = o.domain.features.filter((f) => f.id !== o.feature.id);
      }
      into.by = "human";
      detail = `${others.map((o) => o.feature.name).join(", ")} → ${into.name}`;
      break;
    }
    case "split-feature": {
      const { domain: d, feature: f } = feature(raw.featureId);
      const list = entries(raw.entryIds).filter((id) => f.entryIds.includes(id));
      if (!list.length || list.length === f.entryIds.length) throw new ReviewError("pick some, but not all, of the feature's entry points to split off");
      f.entryIds = f.entryIds.filter((id) => !list.includes(id));
      const nf: Feature = { id: newId("f"), name: text(raw.name, "name", 120), description: "", entryIds: list, by: "human" };
      d.features.splice(d.features.indexOf(f) + 1, 0, nf);
      detail = `${nf.name} split from ${f.name}`;
      break;
    }
    case "set-scope": {
      const { feature: f } = feature(raw.featureId);
      f.outOfScope = !!raw.outOfScope;
      detail = `${f.name} ${f.outOfScope ? "out of" : "back in"} scope`;
      break;
    }
    case "delete-feature": {
      const { domain: d, feature: f } = feature(raw.featureId);
      d.features = d.features.filter((x) => x.id !== f.id);
      detail = `${f.name} removed; its ${f.entryIds.length} entry points are unassigned`;
      break;
    }
    case "move-feature": {
      const { domain: from, feature: f } = feature(raw.featureId);
      const to = domain(raw.toDomainId);
      from.features = from.features.filter((x) => x.id !== f.id);
      to.features.push(f);
      detail = `${f.name} → ${to.name}`;
      break;
    }
    case "new-domain": {
      const name = text(raw.name, "name", 120);
      const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "domain";
      let id = base;
      for (let i = 2; p.domains.some((d) => d.id === id); i++) id = `${base}-${i}`;
      p.domains.push({ id, name, description: optText(raw.description, 1000) ?? "", features: [] });
      detail = name;
      break;
    }
    case "rename-domain": {
      const d = domain(raw.domainId);
      const before = d.name;
      d.name = text(raw.name, "name", 120);
      if (raw.description !== undefined) d.description = optText(raw.description, 1000) ?? "";
      detail = `${before} → ${d.name}`;
      break;
    }
    case "delete-domain": {
      const d = domain(raw.domainId);
      if (d.features.length) throw new ReviewError("move or delete this domain's features first");
      p.domains = p.domains.filter((x) => x.id !== d.id);
      detail = d.name;
      break;
    }
    case "edit-entry": {
      if (!known.has(raw.entryId)) throw new ReviewError(`not an entry point: ${raw.entryId}`);
      const note = p.entries[raw.entryId] ?? { title: raw.entryId, summary: "", actor: "User", by: "human" as const };
      if (raw.title !== undefined) note.title = text(raw.title, "title", 200);
      if (raw.summary !== undefined) note.summary = optText(raw.summary, 2000) ?? "";
      note.by = "human";
      p.entries[raw.entryId] = note;
      detail = note.title;
      break;
    }
    case "dismiss-note": {
      const before = p.notes.length;
      p.notes = p.notes.filter((n) => n.id !== raw.noteId);
      if (p.notes.length === before) throw new ReviewError(`no note ${raw.noteId}`);
      log(p, "note dismissed", raw.noteId);
      return "note dismissed";
    }
    default:
      throw new ReviewError(`unknown operation ${(raw as { op?: string }).op}`);
  }
  if (p.approval && raw.op !== "edit-entry") {
    p.approval = undefined;
    log(p, "gate reopened", "the feature tree changed after it was approved");
  }
  log(p, raw.op, detail);
  return detail;
}

export function approveTree(p: Project, inv: Inventory): void {
  const c = coverage(p, inv);
  if (!c.complete) {
    const why = c.total === 0 ? "the inventory has no entry points" : c.unassigned.length ? `${c.unassigned.length} entry point${c.unassigned.length > 1 ? "s are" : " is"} not in any feature` : `${c.duplicated.length} entry points are in more than one feature`;
    throw new ReviewError(`The tree can't be approved yet: ${why}.`);
  }
  p.approval = { at: new Date().toISOString(), sha: inv.sha };
  log(p, "tree approved", `${c.inScope} entry points in scope, ${c.outOfScope} out of scope`);
}

// ---------------------------------------------------------------- backlog

export type BacklogOp =
  | { op: "edit-epic"; epicId: string; title?: string; description?: string }
  | { op: "set-epic"; epicId: string; status: "approved" | "rejected" | "draft" }
  | { op: "approve-all"; epicId: string }
  | { op: "delete-epic"; epicId: string }
  | { op: "edit-story"; epicId: string; storyId: string; title?: string; userStory?: string; technical?: string; acceptance?: string[]; size?: "S" | "M" | "L" }
  | { op: "set-story"; epicId: string; storyId: string; status: "approved" | "rejected" | "draft" }
  | { op: "add-story"; epicId: string; title: string; userStory?: string; technical?: string; acceptance?: string[] }
  | { op: "delete-story"; epicId: string; storyId: string };

export function applyBacklogOp(p: Project, raw: BacklogOp): string {
  const epic: Epic = need(p.epics.find((e) => e.id === raw.epicId), `no epic ${raw.epicId}`);
  const story = (id: string): Story => need(epic.stories.find((s) => s.id === id), `no story ${id}`);
  const status = (v: unknown) => {
    if (v !== "approved" && v !== "rejected" && v !== "draft") throw new ReviewError("status must be approved, rejected or draft");
    return v;
  };
  let detail: string;
  switch (raw.op) {
    case "edit-epic":
      if (raw.title !== undefined) epic.title = text(raw.title, "title", 200);
      if (raw.description !== undefined) epic.description = optText(raw.description) ?? "";
      epic.by = "human";
      detail = epic.title;
      break;
    case "set-epic":
      epic.status = status(raw.status);
      if (epic.status === "rejected") for (const s of epic.stories) if (s.status === "approved") s.status = "draft";
      detail = `${epic.title}: ${epic.status}`;
      break;
    case "approve-all": {
      let n = 0;
      for (const s of epic.stories) if (s.status === "draft") {
        s.status = "approved";
        n++;
      }
      epic.status = "approved";
      detail = `${epic.title}: epic and ${n} stories approved`;
      break;
    }
    case "delete-epic":
      p.epics = p.epics.filter((e) => e.id !== epic.id);
      detail = epic.title;
      break;
    case "edit-story": {
      const s = story(raw.storyId);
      if (raw.title !== undefined) s.title = text(raw.title, "title", 200);
      if (raw.userStory !== undefined) s.userStory = optText(raw.userStory) ?? "";
      if (raw.technical !== undefined) s.technical = optText(raw.technical, 12000) ?? "";
      if (raw.acceptance !== undefined) s.acceptance = ids(raw.acceptance, "acceptance").map((a) => a.trim()).filter(Boolean).slice(0, 20);
      if (raw.size !== undefined) {
        if (!["S", "M", "L"].includes(raw.size)) throw new ReviewError("size must be S, M or L");
        s.size = raw.size;
      }
      s.by = "human";
      detail = s.title;
      break;
    }
    case "set-story": {
      const s = story(raw.storyId);
      s.status = status(raw.status);
      if (s.status === "approved" && epic.status === "rejected") epic.status = "draft";
      detail = `${s.title}: ${s.status}`;
      break;
    }
    case "add-story": {
      const s: Story = { id: newId("s"), title: text(raw.title, "title", 200), userStory: optText(raw.userStory) ?? "", technical: optText(raw.technical, 12000) ?? "", acceptance: raw.acceptance ? ids(raw.acceptance, "acceptance").filter(Boolean) : [], elements: [], entries: [], dependsOn: [], size: "M", status: "draft", by: "human" };
      epic.stories.push(s);
      detail = s.title;
      break;
    }
    case "delete-story": {
      const s = story(raw.storyId);
      epic.stories = epic.stories.filter((x) => x.id !== s.id);
      for (const o of epic.stories) o.dependsOn = o.dependsOn.filter((d) => d !== s.id);
      detail = s.title;
      break;
    }
    default:
      throw new ReviewError(`unknown operation ${(raw as { op?: string }).op}`);
  }
  log(p, raw.op, detail);
  return detail;
}

// ---------------------------------------------------------------- export

const POINTS = { S: 2, M: 5, L: 8 } as const;

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function citations(story: Story, inv: Inventory | undefined): string[] {
  const byId = new Map(inv?.elements.map((e) => [e.id, e]) ?? []);
  return story.elements.map((id) => {
    const el = byId.get(id);
    return el ? `${el.name} (${el.file}:${el.line})` : id;
  });
}

function storyDescription(story: Story, epic: Epic, inv: Inventory | undefined, byId: Map<string, Story>): string {
  const parts = [story.userStory, "", "Technical", story.technical];
  if (story.acceptance.length) parts.push("", "Acceptance criteria", ...story.acceptance.map((a) => `- ${a}`));
  const code = citations(story, inv);
  if (code.length) parts.push("", "Code", ...code.map((c) => `- ${c}`));
  const deps = story.dependsOn.map((d) => byId.get(d)?.title).filter(Boolean);
  if (deps.length) parts.push("", "Depends on", ...deps.map((d) => `- ${d}`));
  if (epic.mode === "migrate" && epic.target) parts.push("", `Target: ${epic.target}`);
  return parts.join("\n");
}

export function exportBacklog(p: Project, inv: Inventory | undefined, format: "csv" | "md", opts: { drafts?: boolean } = {}): string {
  const keep = (s: { status: string }) => s.status === "approved" || (opts.drafts && s.status === "draft");
  const epics = p.epics.filter(keep);
  if (format === "csv") {
    // Jira's CSV importer: Issue Id and Parent Id link stories to their epic.
    const rows = [["Issue Id", "Parent Id", "Issue Type", "Summary", "Description", "Labels", "Story Points"]];
    let n = 1;
    for (const e of epics) {
      const epicNo = String(n++);
      const domain = p.domains.find((d) => d.id === e.domainId)?.name ?? "";
      const label = `cartograph ${domain}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
      rows.push([epicNo, "", "Epic", e.title, e.description, label, ""]);
      const byId = new Map(e.stories.map((s) => [s.id, s]));
      for (const s of e.stories.filter(keep)) rows.push([String(n++), epicNo, "Story", s.title, storyDescription(s, e, inv, byId), label, String(POINTS[s.size])]);
    }
    return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }
  const out = [`# ${p.repo.name} backlog`, "", `${p.summary}`, "", `Generated by Cartograph V2 from commit ${p.sha.slice(0, 7)}${p.approval ? `, feature tree approved ${p.approval.at.slice(0, 10)}` : ""}.`, ""];
  for (const e of epics) {
    out.push(`## Epic: ${e.title}`, "", e.description, "");
    const byId = new Map(e.stories.map((s) => [s.id, s]));
    for (const s of e.stories.filter(keep)) {
      out.push(`### ${s.title} (${s.size})`, "", storyDescription(s, e, inv, byId).replace(/^(Technical|Acceptance criteria|Code|Depends on)$/gm, "**$1**"), "");
    }
  }
  return out.join("\n");
}
