// The Investigator's tools: read-only queries against the provenance USL in
// Zetaris. Each returns evidence items an answer can cite by id.
import { asObjects, runSql } from "../zetaris/client";
import { NAMESPACE, USL } from "../zetaris/usl";

const T = (table: string) => `${NAMESPACE}.${USL}.${table}`;

/** A SQL string literal. Zetaris REST takes no bind parameters, so every value goes through here. */
export function lit(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

export type Query = (sql: string) => Promise<Record<string, unknown>[]>;
export const zetarisQuery: Query = async (sql) => asObjects(await runSql(sql, { limit: 2000 }));

/** Zetaris returns every value as a string; turn the named columns back into numbers. */
function numbers<T>(rows: Record<string, unknown>[], keys: string[]): T[] {
  return rows.map((r) => {
    const out = { ...r };
    for (const k of keys) if (out[k] !== null && out[k] !== undefined && out[k] !== "") out[k] = Number(out[k]);
    return out as T;
  });
}

export interface FileRow {
  id: string;
  path: string;
  lines: number;
  language: string;
}

export async function listFiles(q: Query, repo: string): Promise<FileRow[]> {
  return numbers<FileRow>(await q(`SELECT id, path, lines, language FROM ${T("source_file")} WHERE repo_id = ${lit(repo)} ORDER BY path`), ["lines"]);
}

export interface Origin {
  file_id: string;
  line_start: number;
  line_end: number;
  commit_sha: string;
  subject: string;
  body: string | null;
  author_name: string;
  authored_at: string;
  commit_url: string;
  pr_id: string | null;
}

/** Which commits last changed lines [from, to] of a file, newest first. */
export async function lineOrigins(q: Query, fileId: string, from: number, to: number): Promise<Origin[]> {
  return numbers<Origin>(await q(
    `SELECT lo.file_id, lo.line_start, lo.line_end, lo.commit_sha, c.subject, c.body, c.author_name,
            CAST(c.authored_at AS string) AS authored_at, c.url AS commit_url, c.pr_id
     FROM ${T("line_origin")} lo JOIN ${T("code_change")} c ON c.sha = lo.commit_sha
     WHERE lo.file_id = ${lit(fileId)} AND lo.line_end >= ${from} AND lo.line_start <= ${to}
     ORDER BY c.authored_at DESC`,
  ), ["line_start", "line_end"]);
}

export interface Change {
  sha: string;
  subject: string;
  body: string | null;
  author_name: string;
  authored_at: string;
  url: string;
  pr_id: string | null;
}

/** Earlier commits that touched a file, newest first: the file's history beyond blame. */
export async function fileHistory(q: Query, fileId: string, limit = 15): Promise<Change[]> {
  return (await q(
    `SELECT c.sha, c.subject, c.body, c.author_name, CAST(c.authored_at AS string) AS authored_at, c.url, c.pr_id
     FROM ${T("code_change")} c
     JOIN ${T("file_change")} fc ON fc.commit_sha = c.sha
     WHERE fc.file_id = ${lit(fileId)}
     ORDER BY c.authored_at DESC LIMIT ${limit}`,
  )) as unknown as Change[];
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  body: string | null;
  author: string | null;
  merged_at: string | null;
  url: string;
  issue_count: number;
  discussion_count: number;
}

export async function pullRequests(q: Query, ids: string[]): Promise<PullRequest[]> {
  if (ids.length === 0) return [];
  return numbers<PullRequest>(await q(
    `SELECT id, number, title, body, author, CAST(merged_at AS string) AS merged_at, url, issue_count, discussion_count
     FROM ${T("pull_request")} WHERE id IN (${ids.map(lit).join(", ")})`,
  ), ["number", "issue_count", "discussion_count"]);
}

export interface Issue {
  id: string;
  number: number;
  title: string;
  body: string | null;
  labels: string | null;
  state: string;
  url: string;
  pr_id: string;
  relation: string;
}

export async function linkedIssues(q: Query, prIds: string[]): Promise<Issue[]> {
  if (prIds.length === 0) return [];
  return numbers<Issue>(await q(
    `SELECT i.id, i.number, i.title, i.body, i.labels, i.state, i.url, l.pr_id, l.relation
     FROM ${T("pr_issue")} l JOIN ${T("issue")} i ON i.id = l.issue_id
     WHERE l.pr_id IN (${prIds.map(lit).join(", ")})`,
  ), ["number"]);
}

export interface Comment {
  id: string;
  parent_id: string;
  kind: string;
  author: string | null;
  body: string;
  path: string | null;
  line: number | null;
  url: string;
}

/** Discussion on these PRs and issues; inline review comments on the file come first. */
export async function discussion(q: Query, parentIds: string[], path?: string, limit = 30): Promise<Comment[]> {
  if (parentIds.length === 0) return [];
  const onFile = path ? `CASE WHEN path = ${lit(path)} THEN 0 ELSE 1 END` : "0";
  return numbers<Comment>(await q(
    `SELECT id, parent_id, kind, author, body, path, line, url FROM ${T("discussion")}
     WHERE parent_id IN (${parentIds.map(lit).join(", ")}) AND length(body) > 20
     ORDER BY ${onFile}, created_at LIMIT ${limit}`,
  ), ["line"]);
}

/** Commits and pull requests whose text mentions every keyword: for questions with no line. */
export async function searchChanges(q: Query, repo: string, keywords: string[], limit = 12): Promise<Change[]> {
  const words = keywords.map((k) => k.toLowerCase().replace(/[%_]/g, "")).filter((k) => k.length > 2).slice(0, 4);
  if (words.length === 0) return [];
  const match = (col: string) => words.map((w) => `lower(COALESCE(${col}, '')) LIKE ${lit(`%${w}%`)}`).join(" AND ");
  return (await q(
    `SELECT c.sha, c.subject, c.body, c.author_name, CAST(c.authored_at AS string) AS authored_at, c.url, c.pr_id
     FROM ${T("code_change")} c LEFT JOIN ${T("pull_request")} p ON p.id = c.pr_id
     WHERE c.repo_id = ${lit(repo)} AND ((${match("c.subject")}) OR (${match("c.body")}) OR (${match("p.title")}) OR (${match("p.body")}))
     ORDER BY c.authored_at DESC LIMIT ${limit}`,
  )) as unknown as Change[];
}

export interface FileCoverage {
  path: string;
  lines: number;
  blamed_lines: number;
  explained_lines: number;
  reviewed_lines: number;
}

/**
 * How explainable each file is: of its blamed lines, how many trace to a
 * pull request (reviewed) and how many to a PR that states a reason
 * (linked issue or a real description).
 */
export async function coverage(q: Query, repo: string): Promise<FileCoverage[]> {
  return numbers<FileCoverage>(await q(
    `SELECT f.path, f.lines, CAST(SUM(lo.line_end - lo.line_start + 1) AS int) AS blamed_lines,
            CAST(SUM(CASE WHEN p.id IS NOT NULL AND (p.issue_count > 0 OR length(COALESCE(p.body, '')) >= 120) THEN lo.line_end - lo.line_start + 1 ELSE 0 END) AS int) AS explained_lines,
            CAST(SUM(CASE WHEN c.pr_id IS NOT NULL THEN lo.line_end - lo.line_start + 1 ELSE 0 END) AS int) AS reviewed_lines
     FROM ${T("line_origin")} lo
     JOIN ${T("source_file")} f ON f.id = lo.file_id
     JOIN ${T("code_change")} c ON c.sha = lo.commit_sha
     LEFT JOIN ${T("pull_request")} p ON p.id = c.pr_id
     WHERE f.repo_id = ${lit(repo)}
     GROUP BY f.path, f.lines ORDER BY f.path`,
  ), ["lines", "blamed_lines", "explained_lines", "reviewed_lines"]);
}

export interface LineStatus {
  line_start: number;
  line_end: number;
  commit_sha: string;
  subject: string;
  pr_number: number | null;
  explained: boolean;
}

/** Blame ranges of one file with whether each traces to a pull request that states a reason. */
export async function lineStatus(q: Query, fileId: string): Promise<LineStatus[]> {
  const rows = await q(
    `SELECT lo.line_start, lo.line_end, lo.commit_sha, c.subject, p.number AS pr_number,
            CASE WHEN p.id IS NOT NULL AND (p.issue_count > 0 OR length(COALESCE(p.body, '')) >= 120) THEN 1 ELSE 0 END AS explained
     FROM ${T("line_origin")} lo JOIN ${T("code_change")} c ON c.sha = lo.commit_sha
     LEFT JOIN ${T("pull_request")} p ON p.id = c.pr_id
     WHERE lo.file_id = ${lit(fileId)} ORDER BY lo.line_start`,
  );
  return numbers<LineStatus>(rows, ["line_start", "line_end", "pr_number"]).map((r) => ({ ...r, explained: Number(r.explained) === 1 }));
}

export async function repositories(q: Query): Promise<{ id: string; description: string | null; head_sha: string; url: string }[]> {
  return (await q(`SELECT id, description, head_sha, url FROM ${T("repository")} ORDER BY id`)) as never;
}
