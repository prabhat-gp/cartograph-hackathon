// The V2 analysis: Scout → Readers → Cartographer → Reviewer, from inventory
// to a feature tree that covers every entry point. A failed or partial model
// answer never leaves a gap: rules fill in (marked by: "rule") so the person
// reviewing sees exactly what still needs a human eye.
import type { AgentRunStat } from "../../shared/graph";
import { humanize } from "../inventory/lex";
import type { Inventory, InventoryElement } from "../inventory/types";
import { type Domain, type EntryNote, type Feature, type Project, type ReviewNote, coverage, newId } from "../project";
import { allSlices, renderSlice } from "../slices";
import { CARTOGRAPHER_PROMPT, CartographerSchema, READER_PROMPT, REVIEWER_PROMPT, ReaderSchema, ReviewerSchema, SCOUT_PROMPT, ScoutSchema } from "./prompts";
import { type RunOptions, chunk, pool, runV2Agent } from "./run";

export interface AnalyzeResult {
  summary: string;
  entries: Record<string, EntryNote>;
  domains: Domain[];
  notes: ReviewNote[];
  stats: AgentRunStat[];
  /** Entry points this run looked at. */
  analysed: number;
}

const GENERIC_SEGMENTS = new Set(["api", "app", "v1", "v2", "v3", "rest", "occ", "public", "private", "internal", "view", "my-account", "{basesiteid}", "*"]);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";

/** A rule-based home for an entry point, used whenever an agent didn't give one. */
export function ruleGroup(el: InventoryElement, byId: Map<string, InventoryElement>): { domain: string; feature: string } {
  const path = (Array.isArray(el.meta?.http) ? (el.meta!.http as string[])[0]?.split(" ")[1] : (el.meta?.path as string | undefined)) ?? "";
  const segs = path.split("/").filter(Boolean).map((s) => s.toLowerCase());
  const first = segs.find((s) => !GENERIC_SEGMENTS.has(s) && !s.startsWith(":") && !s.startsWith("{"));
  if (el.kind === "cronjob") return { domain: "Scheduled jobs", feature: humanize(el.name.replace(/(CronJob|Job)$/i, "")) };
  if (el.kind === "business-process") return { domain: "Business processes", feature: humanize(el.name.replace(/-?process$/i, "")) };
  if (el.kind === "event-listener") return { domain: "Events", feature: humanize(el.name.split(".")[0].replace(/(EventListener|Listener)$/, "")) };
  const owner = el.parent ? byId.get(el.parent) : undefined;
  const ownerName = owner?.name.replace(/(PageController|Controller|Resource|Endpoint|Api)$/, "");
  const area = first ? humanize(first) : ownerName ? humanize(ownerName) : "Home";
  return { domain: area, feature: ownerName ? humanize(ownerName) : area };
}

function excerptOf(excerpts: Map<string, string>, id: string): string {
  const text = excerpts.get(id);
  return text ? `\n  code:\n${text.split("\n").slice(0, 24).map((l) => `    ${l}`).join("\n")}` : "";
}

export async function analyze(inv: Inventory, project: Project, excerpts: Map<string, string>, opts: RunOptions & { full?: boolean; limit?: number } = {}): Promise<AnalyzeResult> {
  const stats: AgentRunStat[] = [];
  const run: RunOptions = { ...opts, stats };
  const progress = opts.onProgress ?? (() => undefined);
  const byId = new Map(inv.elements.map((e) => [e.id, e]));
  const slices = allSlices(inv);
  const full = opts.full || project.domains.length === 0;
  const targets = (full ? [...inv.entryPoints] : coverage(project, inv).unassigned).slice(0, opts.limit ?? Infinity);
  const entries: Record<string, EntryNote> = full ? {} : { ...project.entries };
  let domains: Domain[] = full ? [] : structuredClone(project.domains);
  let summary = project.summary;
  if (targets.length === 0) return { summary, entries, domains, notes: project.notes, stats, analysed: 0 };

  // ------------------------------------------------------------ Scout
  let actors: string[] = ["User", "System"];
  if (full || domains.length === 0) {
    progress(`Scout · reading the inventory: ${inv.stats.elements} elements, ${inv.entryPoints.length} entry points`);
    const modules = inv.elements.filter((e) => e.kind === "extension").map((e) => e.name);
    const folders = new Map<string, number>();
    for (const el of inv.elements) {
      const key = el.file.split("/").slice(0, 3).join("/");
      folders.set(key, (folders.get(key) ?? 0) + 1);
    }
    const listed = inv.entryPoints.slice(0, 500).map((id) => {
      const el = byId.get(id)!;
      const http = Array.isArray(el.meta?.http) ? ` ${(el.meta!.http as string[]).slice(0, 2).join(", ")}` : "";
      return `- [${el.kind}] ${el.name}${http}`;
    });
    const input = [
      `Repository: ${project.repo.name}`,
      `Stack: ${inv.stack.join(", ") || "unknown"}`,
      `Counts: ${Object.entries(inv.stats.byKind).map(([k, v]) => `${k} ${v}`).join(", ")}`,
      modules.length ? `Extensions/modules: ${modules.join(", ")}` : "",
      `Top folders: ${[...folders].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k} (${v})`).join(", ")}`,
      `Entry points (${inv.entryPoints.length}${inv.entryPoints.length > 500 ? ", first 500 shown" : ""}):`,
      ...listed,
    ].filter(Boolean).join("\n");
    try {
      const scout = await runV2Agent("scout", "scout", SCOUT_PROMPT, ScoutSchema, input, run);
      summary = scout.summary;
      actors = scout.actors.length ? scout.actors : actors;
      const ids = new Set<string>();
      domains = scout.domains.map((d) => {
        let id = slug(d.id || d.name);
        while (ids.has(id)) id += "-2";
        ids.add(id);
        return { id, name: d.name, description: d.description, features: [] };
      });
      progress(`Scout · ${domains.length} domains: ${domains.map((d) => d.name).join(", ")}`);
    } catch (error) {
      opts.signal?.throwIfAborted();
      progress(`Scout · failed (${(error as Error).message.slice(0, 80)}); grouping by rule`);
    }
  }
  const domainFor = (raw: string | undefined, el: InventoryElement): string => {
    if (raw) {
      const s = slug(raw);
      const hit = domains.find((d) => d.id === s || slug(d.name) === s);
      if (hit) return hit.id;
    }
    // Rule: match the entry's area to a domain by name, or make a domain for it.
    const area = ruleGroup(el, byId).domain;
    const words = area.toLowerCase().split(/\s+/);
    const hit = domains.find((d) => words.some((w) => w.length > 2 && `${d.name} ${d.description}`.toLowerCase().includes(w)));
    if (hit) return hit.id;
    const id = slug(area);
    if (!domains.some((d) => d.id === id)) domains.push({ id, name: area, description: `Entry points grouped by rule under ${area}.`, features: [] });
    return id;
  };

  // ------------------------------------------------------------ Readers
  const placedDomain = new Map<string, string>();
  const batches = chunk(targets, 10);
  progress(`Readers · ${targets.length} entry points in ${batches.length} batches`);
  let done = 0;
  await pool(batches, 4, async (batch, b) => {
    const refs = new Map(batch.map((id, i) => [`e${i + 1}`, id]));
    const elementRefs = new Map<string, string>();
    const ref = (id: string) => {
      if (!elementRefs.has(id)) elementRefs.set(id, `x${elementRefs.size + 1}`);
      return elementRefs.get(id)!;
    };
    const input = [
      `Actors: ${actors.join(", ")}`,
      `Domains:\n${domains.map((d) => `- ${d.id}: ${d.name} (${d.description})`).join("\n") || "- other: Other"}`,
      "",
      ...[...refs].map(([r, id]) => `ENTRY ${r}\n${renderSlice(slices.get(id)!, byId, ref)}${excerptOf(excerpts, id)}`),
    ].join("\n");
    let answered = new Map<string, { title: string; summary: string; actor: string; domain: string }>();
    try {
      const out = await runV2Agent("reader", `reader ${b + 1}/${batches.length}`, READER_PROMPT, ReaderSchema, input, run);
      answered = new Map(out.entries.filter((e) => refs.has(e.ref)).map((e) => [refs.get(e.ref)!, e]));
    } catch (error) {
      opts.signal?.throwIfAborted();
      progress(`Reader ${b + 1}/${batches.length} · failed (${(error as Error).message.slice(0, 60)}); titles by rule`);
    }
    for (const id of batch) {
      const el = byId.get(id)!;
      const a = answered.get(id);
      if (a && a.title.trim()) {
        entries[id] = { title: a.title.trim(), summary: a.summary.trim(), actor: a.actor.trim() || "User", by: "agent" };
        placedDomain.set(id, domainFor(a.domain, el));
      } else {
        const http = Array.isArray(el.meta?.http) ? (el.meta!.http as string[])[0] : "";
        entries[id] = { title: humanize(el.name.split(".").pop()!), summary: `${el.kind} ${el.name}${http ? ` (${http})` : ""}.`, actor: el.kind === "endpoint" || el.kind === "route" ? "User" : "System", by: "rule" };
        placedDomain.set(id, domainFor(undefined, el));
      }
    }
    done += batch.length;
    progress(`Readers · ${done}/${targets.length} entry points described`);
  });

  // ------------------------------------------------------------ Cartographer, per domain
  const byDomain = new Map<string, string[]>();
  for (const id of targets) byDomain.set(placedDomain.get(id)!, [...(byDomain.get(placedDomain.get(id)!) ?? []), id]);
  await pool([...byDomain], 3, async ([domainId, ids]) => {
    const domain = domains.find((d) => d.id === domainId)!;
    for (const part of chunk(ids, 100)) {
      const refs = new Map(part.map((id, i) => [`e${i + 1}`, id]));
      const input = [
        `Domain: ${domain.name} — ${domain.description}`,
        domain.features.length ? `Existing features:\n${domain.features.map((f) => `- id ${f.id}: ${f.name} — ${f.description}`).join("\n")}` : "Existing features: none",
        "Entry points:",
        ...[...refs].map(([r, id]) => `- ${r}: ${entries[id].title} — ${entries[id].summary} (actor: ${entries[id].actor})`),
      ].join("\n");
      const placed = new Set<string>();
      try {
        const out = await runV2Agent("cartographer", `cartographer ${domain.name}`, CARTOGRAPHER_PROMPT, CartographerSchema, input, run);
        for (const f of out.features) {
          const ids2 = f.refs.map((r) => refs.get(r)).filter((id): id is string => !!id && !placed.has(id));
          if (!ids2.length) continue;
          ids2.forEach((id) => placed.add(id));
          const existing = f.id ? domain.features.find((x) => x.id === f.id) : domain.features.find((x) => x.name.toLowerCase() === f.name.toLowerCase());
          if (existing) existing.entryIds.push(...ids2);
          else domain.features.push({ id: newId("f"), name: f.name.trim(), description: f.description.trim(), entryIds: ids2, by: "agent" });
        }
        progress(`Cartographer · ${domain.name}: ${domain.features.length} features`);
      } catch (error) {
        opts.signal?.throwIfAborted();
        progress(`Cartographer · ${domain.name} failed (${(error as Error).message.slice(0, 60)}); grouping by rule`);
      }
      // Whatever the agent left out goes to a rule-made feature, never nowhere.
      for (const id of part) {
        if (placed.has(id)) continue;
        const name = ruleGroup(byId.get(id)!, byId).feature;
        let f = domain.features.find((x) => x.name === name && x.by === "rule");
        if (!f) {
          f = { id: newId("f"), name, description: `Grouped by rule: entry points of ${name}. Check and rename.`, entryIds: [], by: "rule" };
          domain.features.push(f);
        }
        f.entryIds.push(id);
      }
    }
  });
  domains = domains.filter((d) => d.features.some((f) => f.entryIds.length));
  for (const d of domains) d.features = d.features.filter((f) => f.entryIds.length);

  // ------------------------------------------------------------ Reviewer
  const notes: ReviewNote[] = [];
  const fRefs = new Map<string, Feature>();
  const tree = domains.map((d) => `${d.name}\n${d.features.map((f) => {
    const r = `f${fRefs.size + 1}`;
    fRefs.set(r, f);
    return `  ${r} ${f.name}: ${f.entryIds.slice(0, 15).map((id) => entries[id]?.title ?? id).join("; ")}${f.entryIds.length > 15 ? ` (+${f.entryIds.length - 15} more)` : ""}`;
  }).join("\n")}`).join("\n");
  try {
    const out = await runV2Agent("reviewer", "reviewer", REVIEWER_PROMPT, ReviewerSchema, tree.slice(0, 60_000), run);
    // Refs like "f3" mean nothing to a reader: name the feature instead.
    const named = (t: string) => t.replace(/\s*\((?:from\s+)?(f\d+)(?:\s+split)?\)/gi, "").replace(/\b(f\d+)\b/g, (m) => (fRefs.has(m) ? `"${fRefs.get(m)!.name}"` : m));
    for (const n of out.notes.slice(0, 12)) notes.push({ id: newId("n"), featureId: n.feature ? fRefs.get(n.feature)?.id : undefined, severity: n.severity, message: named(n.message), by: "agent" });
    progress(`Reviewer · ${notes.length} notes`);
  } catch (error) {
    opts.signal?.throwIfAborted();
    progress(`Reviewer · failed (${(error as Error).message.slice(0, 60)}); rule checks only`);
  }
  for (const d of domains) for (const f of d.features) {
    if (f.entryIds.length > 25) notes.push({ id: newId("n"), featureId: f.id, severity: "warning", message: `${f.name} holds ${f.entryIds.length} entry points. Consider splitting it before writing stories.`, by: "rule" });
    if (f.by === "rule") notes.push({ id: newId("n"), featureId: f.id, severity: "info", message: `${f.name} was grouped by rule because an agent didn't place these entry points. Check it.`, by: "rule" });
  }
  return { summary, entries, domains, notes, stats, analysed: targets.length };
}
