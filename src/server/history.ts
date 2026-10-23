// The git history behind a map. The first time someone asks why a
// dependency exists, Cartograph reads the repository's history into the
// evidence store (Postgres, read by Zetaris): commits, blame for the files
// the map cites, and for GitHub repositories the pull requests and issues
// behind them. Later questions reuse it.
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { CartographGraph, RepoRef } from "../shared/graph";
import { ingestRepository } from "../ingest";
import { db, migrate } from "../store/pg";
import { repoDir } from "./repo";

export interface HistoryTarget {
  id: string;
  dir: string;
  github: string | null;
}

export function historyTarget(repo: RepoRef): HistoryTarget {
  const github = repo.source === "github" ? repo.name : null;
  return { id: github ?? `local/${path.basename(repo.location)}`, dir: repoDir(repo), github };
}

/** Files the map cites: the lines a "why" question will start from. */
export function citedFiles(graph: CartographGraph): string[] {
  return [...new Set(graph.edges.flatMap((e) => e.evidence.map((ev) => ev.path)))];
}

function githubToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const inFlight = new Map<string, Promise<HistoryTarget>>();
let migrated: Promise<unknown> | undefined;

/**
 * Makes sure the evidence store has this map's history at the map's commit.
 * Concurrent callers share one ingest.
 */
/** Connection failures from pg can carry an empty message; say what to check. */
function unreachable(error: unknown): Error {
  const code = (error as { code?: string }).code;
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || !(error instanceof Error) || !error.message) {
    return new Error("The evidence store isn't reachable. Is the SSH tunnel to the Zetaris server up (ports 8888 and 5433)?");
  }
  return error;
}

export function ensureHistory(graph: CartographGraph, log: (m: string) => void = () => undefined): Promise<HistoryTarget> {
  const target = historyTarget(graph.repo);
  const key = `${target.id}@${graph.sha}`;
  const running = inFlight.get(key);
  if (running) return running;
  const job = (async (): Promise<HistoryTarget> => {
    migrated ??= migrate();
    await migrated;
    // Cartograph reads its clone with ls-tree/show at a commit, never the working
    // tree, so checking out the mapped commit is safe and makes blame line up
    // with the map's citations. A local folder is the user's own: left alone.
    if (target.github) {
      const head = execFileSync("git", ["-C", target.dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      if (head !== graph.sha) execFileSync("git", ["-C", target.dir, "checkout", "--quiet", "--detach", graph.sha]);
    }
    const { rows } = await db().query<{ head_sha: string }>("SELECT head_sha FROM repository WHERE id = $1", [target.id]);
    const blamed = await db().query<{ n: string }>(
      "SELECT COUNT(DISTINCT lo.file_id) AS n FROM line_origin lo JOIN source_file f ON f.id = lo.file_id WHERE f.repo_id = $1",
      [target.id],
    );
    if (rows[0]?.head_sha === graph.sha && Number(blamed.rows[0]?.n) > 0) return target;
    const token = target.github ? githubToken() : "";
    await ingestRepository(db(), target, {
      commits: 400,
      pullRequests: target.github && token ? 60 : 0,
      blameFiles: 0,
      blamePaths: citedFiles(graph),
      githubToken: token,
      log,
    });
    return target;
  })().catch((error) => {
    migrated = undefined;
    throw unreachable(error);
  });
  inFlight.set(key, job);
  job.finally(() => inFlight.delete(key)).catch(() => undefined);
  return job;
}
