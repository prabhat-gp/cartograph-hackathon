// V2 REST client and the shapes the server sends. Paths are relative, so the
// secret prefix (/<token>/app) carries over to /<token>/api/v2 by itself.
import type { Coverage, Project } from "../../../v2/project";
import type { ElementKind, InventoryElement, InventoryFile, InventoryLink, Inventory } from "../../../v2/inventory/types";
import type { V2Job } from "../../../v2/jobs";

export type { Coverage, Domain, Epic, EntryNote, Feature, Project, ReviewNote, Story, StoryMode } from "../../../v2/project";
export type { ElementKind, InventoryElement, InventoryFile, LinkKind } from "../../../v2/inventory/types";
export type { V2Job } from "../../../v2/jobs";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`api/v2${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(res.ok ? "The server sent something unexpected." : `The server answered ${res.status}.`, res.status);
  }
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `The server answered ${res.status}.`, res.status);
  return data as T;
}

export interface ProjectSummary {
  key: string;
  repo: Project["repo"];
  sha: string;
  scannedAt: string;
  stack: string[];
  summary: string;
  stats?: Inventory["stats"];
  coverage?: Omit<Coverage, "unassigned" | "duplicated"> & { unassigned: number; duplicated: number };
  approved: boolean;
  features: number;
  epics: number;
  approvedStories: number;
  job?: string;
}

export interface EntryIndexRow {
  id: string;
  kind: ElementKind;
  name: string;
  file: string;
  line: number;
  http?: string;
}

export interface ProjectPayload {
  project: Project;
  summary: ProjectSummary;
  coverage: Coverage | null;
  entryIndex: EntryIndexRow[];
  unreached: number;
}

export interface Brief {
  id: string;
  kind: ElementKind | "unknown";
  name: string;
  file: string;
  line: number;
}

export interface ElementPayload {
  element: InventoryElement;
  outgoing: (InventoryLink & { target: Brief })[];
  incoming: (InventoryLink & { source: Brief })[];
  slice?: { id: string; depth: number; via?: string; from?: string; entry?: boolean; element: Brief }[];
  code?: string;
  entry?: { title: string; summary: string; actor: string; by: string } | null;
}

export interface ElementsPage {
  total: number;
  offset: number;
  elements: InventoryElement[];
}

export interface FilesPage {
  total: number;
  offset: number;
  files: InventoryFile[];
}

export const getJob = (id: string) => api<V2Job>(`/jobs/${id}`);
export const enc = encodeURIComponent;
