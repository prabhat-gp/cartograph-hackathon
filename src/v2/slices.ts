// Slices: for each entry point, the elements it reaches by following links
// (calls, renders, includes, CMS placement, HTTP calls, the beans a cronjob
// or process runs). A slice is what a Reader agent sees for one entry point,
// and what a story cites. Computed from the inventory, no model involved.
import { ENTRY_KINDS, type Inventory, type InventoryElement, type InventoryLink, type LinkKind } from "./inventory/types";

const FOLLOW: ReadonlySet<LinkKind> = new Set<LinkKind>(["calls", "renders", "includes", "uses", "places", "populates", "http", "runs", "defines", "contains"]);
/** Kinds whose children (methods) are part of the behaviour when the kind itself is reached. */
const OPENS_CHILDREN = new Set(["event-listener", "job", "process-action", "cms-controller", "populator", "converter", "interceptor"]);

export interface SliceStep {
  id: string;
  depth: number;
  via?: LinkKind;
  from?: string;
  /** Another entry point: shown, not walked into (it is its own functionality). */
  entry?: boolean;
}

export interface Slice {
  entry: string;
  steps: SliceStep[];
  truncated: boolean;
}

export function outgoing(inv: Inventory): Map<string, InventoryLink[]> {
  const out = new Map<string, InventoryLink[]>();
  for (const l of inv.links) {
    if (!FOLLOW.has(l.kind)) continue;
    const list = out.get(l.from);
    if (list) list.push(l);
    else out.set(l.from, [l]);
  }
  return out;
}

export function sliceOf(inv: Inventory, entry: string, index: { byId: Map<string, InventoryElement>; out: Map<string, InventoryLink[]> }, limits = { depth: 8, nodes: 60 }): Slice {
  const seen = new Set([entry]);
  const steps: SliceStep[] = [{ id: entry, depth: 0 }];
  let truncated = false;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.depth >= limits.depth || step.entry) continue;
    const el = index.byId.get(step.id);
    for (const l of index.out.get(step.id) ?? []) {
      // A class's methods only count when the class itself is the behaviour (a listener, a job…).
      if (l.kind === "contains" && !(step.depth === 0 || OPENS_CHILDREN.has(el?.kind ?? ""))) continue;
      const target = index.byId.get(l.to);
      if (!target || seen.has(l.to)) continue;
      if (steps.length >= limits.nodes) {
        truncated = true;
        break;
      }
      seen.add(l.to);
      steps.push({ id: l.to, depth: step.depth + 1, via: l.kind, from: step.id, ...(ENTRY_KINDS.has(target.kind) ? { entry: true } : {}) });
    }
  }
  return { entry, steps, truncated };
}

export function allSlices(inv: Inventory): Map<string, Slice> {
  const index = { byId: new Map(inv.elements.map((e) => [e.id, e])), out: outgoing(inv) };
  return new Map(inv.entryPoints.map((id) => [id, sliceOf(inv, id, index)]));
}

/** Behaviour no entry point reaches: dead code, or wiring the parsers can't see yet. */
export function unreached(inv: Inventory, slices: Map<string, Slice>): InventoryElement[] {
  const reached = new Set<string>();
  for (const s of slices.values()) for (const step of s.steps) if (!step.entry) reached.add(step.id);
  for (const id of slices.keys()) reached.add(id);
  const behaviour = new Set(["method", "component", "hook", "function", "jsp-page", "cms-page", "business-process", "cronjob"]);
  const byId = new Map(inv.elements.map((e) => [e.id, e]));
  return inv.elements.filter((e) => {
    if (!behaviour.has(e.kind) || reached.has(e.id)) return false;
    if (e.kind === "method") {
      const owner = e.parent ? byId.get(e.parent) : undefined;
      // Getters, setters and model or interface methods aren't behaviour on their own.
      if (!owner || ["model", "interface", "config"].includes(owner.kind) || /\.(get|set|is)[A-Z]\w*$/.test(e.name) || e.meta?.ctor) return false;
    }
    return true;
  });
}

/** A compact, line-per-step rendering of a slice for agents. */
export function renderSlice(slice: Slice, byId: Map<string, InventoryElement>, ref: (id: string) => string): string {
  const lines: string[] = [];
  for (const step of slice.steps) {
    const el = byId.get(step.id);
    if (!el) continue;
    const facts: string[] = [];
    for (const k of ["http", "view", "slots", "schedule", "listens", "label", "template", "steps"] as const) {
      const v = el.meta?.[k];
      if (v) facts.push(`${k}: ${Array.isArray(v) ? v.slice(0, 6).join(", ") : v}`);
    }
    if (el.meta?.model) facts.push(`model: ${(el.meta.model as string[]).slice(0, 8).join(", ")}`);
    const indent = "  ".repeat(Math.min(step.depth, 6));
    lines.push(`${indent}${step.via ? `${step.via} ` : ""}${step.entry ? "(separate entry point) " : ""}${ref(el.id)} [${el.kind}] ${el.name} (${el.file.split("/").slice(-2).join("/")}:${el.line})${facts.length ? ` · ${facts.join(" · ")}` : ""}`);
  }
  if (slice.truncated) lines.push("  … (slice cut at 60 elements)");
  return lines.join("\n");
}
