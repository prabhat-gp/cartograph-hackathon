// Pull requests with their commits, linked issues and discussion, read
// through GitHub's GraphQL API in pages (one request per page, not one
// per pull request).

const ENDPOINT = "https://api.github.com/graphql";

const QUERY = `
query($owner: String!, $name: String!, $cursor: String, $page: Int!) {
  repository(owner: $owner, name: $name) {
    description
    url
    defaultBranchRef { name }
    pullRequests(first: $page, after: $cursor, states: MERGED, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title body state url createdAt mergedAt
        author { login }
        mergeCommit { oid }
        commits(first: 100) { nodes { commit { oid } } }
        closingIssuesReferences(first: 10) {
          nodes {
            number title body state url createdAt closedAt
            author { login }
            labels(first: 10) { nodes { name } }
            comments(first: 15) { nodes { id url createdAt body author { login } } }
          }
        }
        comments(first: 20) { nodes { id url createdAt body author { login } } }
        reviews(first: 15) {
          nodes {
            id url createdAt body state author { login }
            comments(first: 20) { nodes { id url createdAt body path line author { login } } }
          }
        }
      }
    }
  }
  rateLimit { remaining resetAt cost }
}`;

interface Login { login: string }
interface Comment { id: string; url: string; createdAt: string; body: string; author: Login | null; path?: string; line?: number | null }

export interface GhIssue {
  number: number; title: string; body: string; state: string; url: string; createdAt: string; closedAt: string | null;
  author: Login | null; labels: { nodes: { name: string }[] }; comments: { nodes: Comment[] };
}

export interface GhPullRequest {
  number: number; title: string; body: string; state: string; url: string; createdAt: string; mergedAt: string | null;
  author: Login | null; mergeCommit: { oid: string } | null;
  commits: { nodes: { commit: { oid: string } }[] };
  closingIssuesReferences: { nodes: GhIssue[] };
  comments: { nodes: Comment[] };
  reviews: { nodes: (Comment & { state: string; comments: { nodes: Comment[] } })[] };
}

export interface GhRepository {
  description: string | null;
  url: string;
  defaultBranch: string;
  pullRequests: GhPullRequest[];
  rateRemaining: number;
}

/** Most recently updated merged pull requests, up to `limit`. */
export async function fetchPullRequests(repo: string, limit: number, token: string, doFetch: typeof fetch = fetch): Promise<GhRepository> {
  const [owner, name] = repo.split("/");
  const pullRequests: GhPullRequest[] = [];
  let cursor: string | null = null;
  let meta: Omit<GhRepository, "pullRequests"> | undefined;
  while (pullRequests.length < limit) {
    const page = Math.min(25, limit - pullRequests.length);
    const res = await doFetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "cartograph-hackathon" },
      body: JSON.stringify({ query: QUERY, variables: { owner, name, cursor, page } }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as {
      data?: { repository: { description: string | null; url: string; defaultBranchRef: { name: string } | null; pullRequests: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: GhPullRequest[] } }; rateLimit: { remaining: number } };
      errors?: { message: string }[];
    };
    if (body.errors?.length || !body.data?.repository) throw new Error(`GitHub GraphQL: ${body.errors?.map((e) => e.message).join("; ") ?? "repository not found"}`);
    const r = body.data.repository;
    meta = { description: r.description, url: r.url, defaultBranch: r.defaultBranchRef?.name ?? "main", rateRemaining: body.data.rateLimit.remaining };
    pullRequests.push(...r.pullRequests.nodes);
    if (!r.pullRequests.pageInfo.hasNextPage) break;
    cursor = r.pullRequests.pageInfo.endCursor;
  }
  return { ...meta!, pullRequests };
}

/** "#123", "owner/name#123" and issue URLs in a PR body that aren't closing references. */
export function mentionedIssues(repo: string, text: string): number[] {
  const numbers = new Set<number>();
  const own = repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`(?:^|[^\\w/])#(\\d+)\\b`, "g"),
    new RegExp(`\\b${own}#(\\d+)\\b`, "g"),
    new RegExp(`github\\.com/${own}/(?:issues|pull)/(\\d+)`, "g"),
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) numbers.add(Number(m[1]));
  return [...numbers];
}
