// Ingests one repository into the evidence store: git history and blame
// from a local clone, pull requests, issues and discussion from GitHub.
import type pg from "pg";
import { refreshDerived, upsert } from "../store/pg";
import { blameRanges, headInfo, listSourceFiles, readCommits, readCommitsBySha, syncClone } from "./git";
import { fetchIssuesByNumber, fetchPullRequests, fetchPullRequestsByNumber, mentionedIssues, subjectPullRequest, type GhIssue } from "./github";

export interface IngestOptions {
  commits: number;
  pullRequests: number;
  /** Files to blame, most recently changed first. */
  blameFiles: number;
  githubToken: string;
  log?: (message: string) => void;
}

export interface IngestSummary {
  repo: string;
  headSha: string;
  files: number;
  commits: number;
  lineRanges: number;
  pullRequests: number;
  issues: number;
  discussion: number;
}

export async function ingestRepository(client: pg.Pool, repo: string, opts: IngestOptions): Promise<IngestSummary> {
  const log = opts.log ?? (() => undefined);
  const id = (n: number) => `${repo}#${n}`;
  const fileId = (p: string) => `${repo}:${p}`;

  log(`cloning ${repo}`);
  const dir = await syncClone(repo);
  const head = await headInfo(dir);

  log("reading pull requests from GitHub");
  const gh = await fetchPullRequests(repo, opts.pullRequests, opts.githubToken);

  await upsert(client, "repository", ["id"], [{
    id: repo, default_branch: head.branch, description: gh.description, url: gh.url, head_sha: head.sha, ingested_at: new Date().toISOString(),
  }]);

  log(`reading ${opts.commits} commits`);
  const commits = await readCommits(dir, opts.commits);
  await upsert(client, "git_commit", ["sha"], commits.map((c) => ({
    sha: c.sha, repo_id: repo, author_name: c.authorName, author_email: c.authorEmail, authored_at: c.authoredAt,
    subject: c.subject, body: c.body || null, url: `${gh.url}/commit/${c.sha}`,
  })));
  await upsert(client, "commit_file", ["commit_sha", "file_id"], commits.flatMap((c) => c.files.map((f) => ({
    commit_sha: c.sha, file_id: fileId(f.path), additions: f.additions, deletions: f.deletions,
  }))));

  log("listing source files");
  const files = await listSourceFiles(dir);
  await upsert(client, "source_file", ["id"], files.map((f) => ({ id: fileId(f.path), repo_id: repo, path: f.path, language: f.language, lines: f.lines })));

  // Blame the files that changed most recently: that's where "why" questions land.
  const recency = new Map<string, number>();
  commits.forEach((c, i) => c.files.forEach((f) => { if (!recency.has(f.path)) recency.set(f.path, i); }));
  const toBlame = [...files].sort((a, b) => (recency.get(a.path) ?? Infinity) - (recency.get(b.path) ?? Infinity)).slice(0, opts.blameFiles);
  log(`blaming ${toBlame.length} files`);
  let lineRanges = 0;
  for (const f of toBlame) {
    const ranges = await blameRanges(dir, f.path);
    await client.query("DELETE FROM line_origin WHERE file_id = $1", [fileId(f.path)]);
    await upsert(client, "line_origin", ["file_id", "line_start"], ranges.map((r) => ({
      file_id: fileId(f.path), line_start: r.lineStart, line_end: r.lineEnd, commit_sha: r.commitSha,
    })));
    lineRanges += ranges.length;
  }

  // Blame can point at commits older than the window we read; fetch those too
  // so every line resolves to a commit with a message.
  const known = new Set(commits.map((c) => c.sha));
  const { rows: missing } = await client.query<{ commit_sha: string }>(
    "SELECT DISTINCT commit_sha FROM line_origin lo JOIN source_file f ON f.id = lo.file_id WHERE f.repo_id = $1 AND NOT EXISTS (SELECT 1 FROM git_commit c WHERE c.sha = lo.commit_sha)",
    [repo],
  );
  const older = missing.map((r) => r.commit_sha).filter((sha) => !known.has(sha));
  if (older.length) {
    log(`reading ${older.length} older commits referenced by blame`);
    const extra = await readCommitsBySha(dir, older);
    await upsert(client, "git_commit", ["sha"], extra.map((c) => ({
      sha: c.sha, repo_id: repo, author_name: c.authorName, author_email: c.authorEmail, authored_at: c.authoredAt,
      subject: c.subject, body: c.body || null, url: `${gh.url}/commit/${c.sha}`,
    })));
  }

  // Blamed lines matter most: fetch the pull requests their commits name in
  // "(#123)" even when they are older than the recent window.
  const { rows: blamed } = await client.query<{ subject: string }>(
    "SELECT DISTINCT c.subject FROM line_origin lo JOIN source_file f ON f.id = lo.file_id JOIN git_commit c ON c.sha = lo.commit_sha WHERE f.repo_id = $1",
    [repo],
  );
  const have = new Set(gh.pullRequests.map((p) => p.number));
  const wanted = [...new Set(blamed.map((r) => subjectPullRequest(r.subject)).filter((n): n is number => n !== null && !have.has(n)))];
  if (wanted.length) log(`fetching ${wanted.length} older pull requests named by blamed commits`);
  const prs = [...gh.pullRequests, ...(wanted.length ? await fetchPullRequestsByNumber(repo, wanted, opts.githubToken) : [])];
  log(`storing ${prs.length} pull requests`);
  await upsert(client, "pull_request", ["id"], prs.map((p) => ({
    id: id(p.number), repo_id: repo, number: p.number, title: p.title, body: p.body || null, state: p.state,
    author: p.author?.login ?? null, created_at: p.createdAt, merged_at: p.mergedAt, merge_commit_sha: p.mergeCommit?.oid ?? null, url: p.url,
  })));
  // A squash or merge commit is what blame sees on the default branch, so it links to the PR too.
  await upsert(client, "pr_commit", ["pr_id", "commit_sha"], prs.flatMap((p) => [
    ...p.commits.nodes.map((n) => ({ pr_id: id(p.number), commit_sha: n.commit.oid })),
    ...(p.mergeCommit ? [{ pr_id: id(p.number), commit_sha: p.mergeCommit.oid }] : []),
  ]));

  const issues = new Map<number, GhIssue>();
  const links: { pr_id: string; issue_id: string; relation: string }[] = [];
  for (const p of prs) {
    const closing = new Set<number>();
    for (const i of p.closingIssuesReferences.nodes) {
      issues.set(i.number, i);
      closing.add(i.number);
      links.push({ pr_id: id(p.number), issue_id: id(i.number), relation: "closes" });
    }
    for (const n of mentionedIssues(repo, `${p.title}\n${p.body ?? ""}`)) {
      if (!closing.has(n) && n !== p.number) links.push({ pr_id: id(p.number), issue_id: id(n), relation: "mentions" });
    }
  }
  // "Fixes #123" in prose isn't always a formal closing reference: fetch the
  // issues pull requests mention, so the reason they cite is evidence too.
  const prNumbers = new Set(prs.map((p) => p.number));
  const mentioned = [...new Set(links.map((l) => Number(l.issue_id.split("#")[1])))].filter((n) => !issues.has(n) && !prNumbers.has(n));
  if (mentioned.length) {
    log(`fetching ${mentioned.length} issues mentioned by pull requests`);
    for (const i of await fetchIssuesByNumber(repo, mentioned, opts.githubToken)) issues.set(i.number, i);
  }
  await upsert(client, "issue", ["id"], [...issues.values()].map((i) => ({
    id: id(i.number), repo_id: repo, number: i.number, title: i.title, body: i.body || null, state: i.state,
    labels: i.labels.nodes.map((l) => l.name).join(",") || null, author: i.author?.login ?? null,
    created_at: i.createdAt, closed_at: i.closedAt, url: i.url,
  })));
  await upsert(client, "pr_issue", ["pr_id", "issue_id"], links);

  const discussion = [
    ...prs.flatMap((p) => [
      ...p.comments.nodes.map((c) => ({ ...c, parent: id(p.number), kind: "comment" })),
      ...p.reviews.nodes.filter((r) => r.body.trim()).map((r) => ({ ...r, parent: id(p.number), kind: "review" })),
      ...p.reviews.nodes.flatMap((r) => r.comments.nodes.map((c) => ({ ...c, parent: id(p.number), kind: "review_comment" }))),
    ]),
    ...[...issues.values()].flatMap((i) => i.comments.nodes.map((c) => ({ ...c, parent: id(i.number), kind: "comment" }))),
  ].filter((d) => d.body.trim());
  await upsert(client, "discussion", ["id"], discussion.map((d) => ({
    id: d.id, repo_id: repo, parent_id: d.parent, kind: d.kind, author: d.author?.login ?? null, created_at: d.createdAt,
    body: d.body, path: d.path ?? null, line: d.line ?? null, url: d.url,
  })));

  await refreshDerived(client, repo);
  log(`done; GitHub API points left this hour: ${gh.rateRemaining}`);
  return {
    repo, headSha: head.sha, files: files.length, commits: commits.length + older.length, lineRanges,
    pullRequests: prs.length, issues: issues.size, discussion: discussion.length,
  };
}
