// Tiny JSON-file persistence under .cartograph/ — graphs per commit, repo index,
// drift reports and MCP Events subscriptions. Writes are atomic (tmp + rename)
// and reads are cached in memory, which is plenty for one Cartograph server.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CartographGraph,
  type DriftReport,
  GraphSchema,
  type RepoRef,
} from "../shared/graph";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function dataDir(): string {
  return process.env.CARTOGRAPH_DATA_DIR ?? path.join(ROOT, ".cartograph");
}

const cache = new Map<string, unknown>();

function readJson<T>(file: string, fallback: T): T {
  if (cache.has(file)) return cache.get(file) as T;
  const value = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
  cache.set(file, value);
  return value;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  cache.set(file, value);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, file);
}

// ---------------------------------------------------------------- repos

export interface RepoRecord {
  repo: RepoRef;
  branch?: string;
  latestSha?: string;
  mappedAt?: string;
  /** Last sha whose drift was reviewed (or the first mapped sha). */
  reviewedSha?: string;
}

const reposFile = () => path.join(dataDir(), "repos.json");

export function listRepos(): RepoRecord[] {
  return Object.values(readJson<Record<string, RepoRecord>>(reposFile(), {})).sort((a, b) =>
    (b.mappedAt ?? "").localeCompare(a.mappedAt ?? ""),
  );
}

export function getRepo(key: string): RepoRecord | undefined {
  return readJson<Record<string, RepoRecord>>(reposFile(), {})[key];
}

/** Find a repo by key, "owner/name", or a fuzzy suffix ("chai-commerce"). */
export function findRepo(query: string | undefined): RepoRecord | undefined {
  const all = listRepos();
  if (!query) return all[0];
  const q = query.trim().toLowerCase().replace(/\.git$/, "").replace(/\/+$/, "");
  return (
    all.find((r) => r.repo.key === q) ??
    all.find((r) => r.repo.name.toLowerCase() === q) ??
    all.find((r) => q.endsWith(r.repo.name.toLowerCase())) ??
    all.find((r) => r.repo.name.toLowerCase().endsWith(`/${q}`) || r.repo.name.toLowerCase() === q.split("/").pop())
  );
}

export async function upsertRepo(key: string, patch: Partial<RepoRecord> & { repo: RepoRef }): Promise<RepoRecord> {
  const all = readJson<Record<string, RepoRecord>>(reposFile(), {});
  const next = { ...all[key], ...patch };
  await writeJson(reposFile(), { ...all, [key]: next });
  return next;
}

// ---------------------------------------------------------------- graphs

const graphFile = (key: string, sha: string) => path.join(dataDir(), "graphs", key, `${sha}.json`);

export async function saveGraph(graph: CartographGraph): Promise<void> {
  await writeJson(graphFile(graph.repo.key, graph.sha), graph);
}

export function loadGraph(key: string, sha?: string): CartographGraph | undefined {
  const target = sha ?? getRepo(key)?.latestSha;
  if (!target) return undefined;
  const file = graphFile(key, target);
  if (!existsSync(file) && !cache.has(file)) return undefined;
  return GraphSchema.parse(readJson<unknown>(file, undefined));
}

// ---------------------------------------------------------------- drift

const driftFile = (key: string) => path.join(dataDir(), "drift", `${key}.json`);

export function listDrift(key: string): DriftReport[] {
  return readJson<DriftReport[]>(driftFile(key), []);
}

export async function appendDrift(report: DriftReport): Promise<void> {
  const all = listDrift(report.repoKey);
  await writeJson(driftFile(report.repoKey), [report, ...all].slice(0, 100));
}

// ---------------------------------------------------------------- generic docs

/** Small named JSON documents (MCP Events subscriptions, counters, …). */
export function readDoc<T>(name: string, fallback: T): T {
  return readJson<T>(path.join(dataDir(), `${name}.json`), fallback);
}

export async function writeDoc(name: string, value: unknown): Promise<void> {
  await writeJson(path.join(dataDir(), `${name}.json`), value);
}
