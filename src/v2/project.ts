// A V2 project: one repository's feature tree, the completeness gate, and the
// backlog of epics and stories with their review state. Stored as JSON next
// to V1's data (dataDir()/v2), written atomically like the V1 store.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentRunStat, RepoRef } from "../shared/graph";
import { dataDir } from "../server/store";
import type { Inventory } from "./inventory/types";

export type Author = "agent" | "rule" | "human";
export type ReviewStatus = "draft" | "approved" | "rejected";
export type StoryMode = "as-is" | "migrate";

export interface EntryNote {
  title: string;
  summary: string;
  actor: string;
  by: Author;
}

export interface Feature {
  id: string;
  name: string;
  description: string;
  entryIds: string[];
  outOfScope?: boolean;
  by: Author;
}

export interface Domain {
  id: string;
  name: string;
  description: string;
  features: Feature[];
}

export interface ReviewNote {
  id: string;
  featureId?: string;
  severity: "info" | "warning";
  message: string;
  by: Author;
}

export interface Story {
  id: string;
  title: string;
  userStory: string;
  technical: string;
  acceptance: string[];
  /** Inventory element ids this story changes or builds on. */
  elements: string[];
  /** Entry points this story covers. */
  entries: string[];
  dependsOn: string[];
  size: "S" | "M" | "L";
  status: ReviewStatus;
  by: Author;
  notes?: string[];
}

export interface Epic {
  id: string;
  featureId: string;
  domainId: string;
  title: string;
  description: string;
  status: ReviewStatus;
  mode: StoryMode;
  target?: string;
  stories: Story[];
  createdAt: string;
  by: Author;
  notes?: string[];
}

export interface HistoryEntry {
  at: string;
  action: string;
  detail: string;
}

export interface Project {
  version: 1;
  key: string;
  repo: RepoRef;
  branch?: string;
  sha: string;
  scannedAt: string;
  stack: string[];
  summary: string;
  analysis?: { sha: string; at: string; agents: AgentRunStat[] };
  entries: Record<string, EntryNote>;
  domains: Domain[];
  notes: ReviewNote[];
  approval?: { at: string; sha: string };
  epics: Epic[];
  settings: { mode: StoryMode; target: string };
  history: HistoryEntry[];
}

export const newId = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;

// ---------------------------------------------------------------- storage

const dir = () => path.join(dataDir(), "v2");
const projectFile = (key: string) => path.join(dir(), `${key}.project.json`);
const inventoryFile = (key: string) => path.join(dir(), `${key}.inventory.json`);
const projects = new Map<string, Project>();
const inventories = new Map<string, Inventory>();

async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

export function loadProject(key: string): Project | undefined {
  if (projects.has(key)) return projects.get(key);
  const file = projectFile(key);
  if (!existsSync(file)) return undefined;
  const p = JSON.parse(readFileSync(file, "utf8")) as Project;
  projects.set(key, p);
  return p;
}

export async function saveProject(p: Project): Promise<void> {
  projects.set(p.key, p);
  await writeAtomic(projectFile(p.key), JSON.stringify(p, null, 1));
}

export function listProjects(): Project[] {
  const d = dir();
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith(".project.json"))
    .map((f) => loadProject(f.replace(/\.project\.json$/, "")))
    .filter((p): p is Project => !!p)
    .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
}

export function loadInventory(key: string): Inventory | undefined {
  if (inventories.has(key)) return inventories.get(key);
  const file = inventoryFile(key);
  if (!existsSync(file)) return undefined;
  const inv = JSON.parse(readFileSync(file, "utf8")) as Inventory;
  // Keep only a couple in memory: a big inventory is tens of megabytes.
  if (inventories.size >= 2) inventories.delete(inventories.keys().next().value!);
  inventories.set(key, inv);
  return inv;
}

export async function saveInventory(key: string, inv: Inventory): Promise<void> {
  inventories.delete(key);
  inventories.set(key, inv);
  await writeAtomic(inventoryFile(key), JSON.stringify(inv));
}

/** Test hook: forget cached state so a fresh data dir is read. */
export function resetProjectCache(): void {
  projects.clear();
  inventories.clear();
}

// ---------------------------------------------------------------- the gate

export interface Coverage {
  total: number;
  assigned: number;
  inScope: number;
  outOfScope: number;
  unassigned: string[];
  /** Entry points placed in more than one feature. */
  duplicated: string[];
  complete: boolean;
}

export function coverage(p: Project, inv: Inventory): Coverage {
  const entries = new Set(inv.entryPoints);
  const placed = new Map<string, number>();
  let out = 0;
  for (const d of p.domains) for (const f of d.features) for (const id of f.entryIds) {
    if (!entries.has(id)) continue;
    placed.set(id, (placed.get(id) ?? 0) + 1);
    if (f.outOfScope) out++;
  }
  const unassigned = inv.entryPoints.filter((id) => !placed.has(id));
  const duplicated = [...placed].filter(([, n]) => n > 1).map(([id]) => id);
  return {
    total: entries.size,
    assigned: placed.size,
    inScope: placed.size - out,
    outOfScope: out,
    unassigned,
    duplicated,
    complete: entries.size > 0 && unassigned.length === 0 && duplicated.length === 0,
  };
}

export function findFeature(p: Project, featureId: string): { domain: Domain; feature: Feature } | undefined {
  for (const domain of p.domains) {
    const feature = domain.features.find((f) => f.id === featureId);
    if (feature) return { domain, feature };
  }
  return undefined;
}

export function log(p: Project, action: string, detail: string): void {
  p.history.unshift({ at: new Date().toISOString(), action, detail });
  p.history = p.history.slice(0, 200);
}

/**
 * After a new scan: drop entry points that no longer exist from features, and
 * reopen the gate when the set of entry points changed.
 */
export function reconcile(p: Project, inv: Inventory): { added: number; removed: number } {
  const now = new Set(inv.entryPoints);
  const before = new Set<string>();
  let removed = 0;
  for (const d of p.domains) for (const f of d.features) {
    for (const id of f.entryIds) before.add(id);
    const kept = f.entryIds.filter((id) => now.has(id));
    removed += f.entryIds.length - kept.length;
    f.entryIds = kept;
  }
  const added = inv.entryPoints.filter((id) => !before.has(id)).length;
  for (const id of Object.keys(p.entries)) if (!now.has(id)) delete p.entries[id];
  if ((added || removed) && p.approval) {
    p.approval = undefined;
    log(p, "gate reopened", `${added} new and ${removed} removed entry points since the tree was approved`);
  }
  return { added, removed };
}
