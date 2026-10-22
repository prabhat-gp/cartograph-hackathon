// Repository access: resolve a user-supplied repo, clone/pull it, and read the
// files exactly as they are at a commit (via git objects, not the working tree,
// so a map is always reproducible for its sha).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { CommitInfo, RepoRef } from "../shared/graph";
import { dataDir } from "./store";

const exec = promisify(execFile);

export interface RepoFile {
  path: string;
  content: string;
  lines: number;
  /** Rough token estimate (chars / 4). */
  tokens: number;
}

export interface RepoSnapshot {
  repo: RepoRef;
  sha: string;
  branch?: string;
  /** Every tracked path at this sha, including ones we skip reading. */
  tree: string[];
  /** Source files worth analysing, with contents. */
  files: RepoFile[];
  totalTokens: number;
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  previousPath?: string;
  /** Unified diff for this file (may be truncated). */
  patch: string;
}

const MAX_FILE_BYTES = 120_000;
const MAX_PATCH_CHARS = 12_000;

const SOURCE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".java", ".kt", ".rb", ".rs",
  ".php", ".cs", ".swift", ".scala", ".ex", ".exs", ".sql", ".prisma", ".graphql", ".gql",
  ".proto", ".yml", ".yaml", ".toml", ".vue", ".svelte",
]);
const SOURCE_NAMES = new Set([
  "package.json", "dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yml",
  "compose.yaml", "procfile", "requirements.txt", "pyproject.toml", "go.mod", "cargo.toml",
  "gemfile", "pom.xml", "build.gradle", ".env.example", "serverless.yml", "vercel.json",
  "netlify.toml", "fly.toml", "render.yaml", "wrangler.toml", "readme.md",
]);
const SKIP_DIRS = /(^|\/)(node_modules|dist|build|out|\.next|\.nuxt|coverage|vendor|target|\.git|\.venv|venv|__pycache__|\.turbo|\.cache|public|static|assets|fixtures|__snapshots__)(\/|$)/i;
const SKIP_FILES = /(\.min\.(js|css)$|\.map$|\.lock$|-lock\.(json|yaml)$|\.d\.ts$|\.(test|spec)\.[jt]sx?$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$)/i;

export function isSourcePath(p: string): boolean {
  if (SKIP_DIRS.test(p) || SKIP_FILES.test(p)) return false;
  const base = path.posix.basename(p).toLowerCase();
  if (SOURCE_NAMES.has(base)) return true;
  return SOURCE_EXT.has(path.posix.extname(base));
}

/**
 * Auth for private GitHub repos: a read-only GITHUB_TOKEN sent as a per-command
 * header (never written to .git/config or anywhere on disk).
 */
function githubAuth(location: string): string[] {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token || !location.startsWith("https://github.com/")) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`];
}

async function git(cwd: string, args: string[], opts: { input?: string } = {}): Promise<string> {
  const { stdout } = await exec("git", args, {
    cwd,
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    ...(opts.input !== undefined ? { input: opts.input } : {}),
  } as Parameters<typeof exec>[2]);
  return stdout.toString();
}

/**
 * Turn user input into a RepoRef. Accepts:
 *   https://github.com/owner/name(.git), github.com/owner/name, owner/name,
 *   an absolute local path, or "local:/abs/path".
 */
export function resolveRepo(input: string): RepoRef {
  const raw = input.trim().replace(/\/+$/, "");
  const localPath = raw.startsWith("local:") ? raw.slice(6) : raw;
  if (path.isAbsolute(localPath) || localPath.startsWith("~")) {
    const abs = localPath.startsWith("~") ? path.join(process.env.HOME ?? "", localPath.slice(1)) : localPath;
    const name = path.basename(abs);
    return { key: `local__${slug(name)}`, source: "local", name, location: abs };
  }
  const m = raw.match(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com[/:])?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/i);
  if (!m) throw new Error(`Not a GitHub repo or absolute path: "${input}"`);
  const [, owner, name] = m;
  return {
    key: `${slug(owner)}__${slug(name)}`,
    source: "github",
    name: `${owner}/${name}`,
    location: `https://github.com/${owner}/${name}.git`,
    webUrl: `https://github.com/${owner}/${name}`,
  };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

/** Local checkout directory for a repo (the path itself for local repos). */
export function repoDir(repo: RepoRef): string {
  return repo.source === "local" ? repo.location : path.join(dataDir(), "repos", repo.key);
}

/**
 * Make sure we have the repo locally and up to date. Returns the commit to map:
 * `sha` if given (must exist after fetching), else the tip of `branch`/HEAD.
 */
export async function syncRepo(
  repo: RepoRef,
  opts: { branch?: string; sha?: string } = {},
): Promise<{ dir: string; sha: string; branch?: string }> {
  const dir = repoDir(repo);
  if (repo.source === "local") {
    if (!existsSync(path.join(dir, ".git"))) throw new Error(`${dir} is not a git repository`);
    const sha = opts.sha ?? (await git(dir, ["rev-parse", "HEAD"])).trim();
    const branch = (await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")).trim() || undefined;
    return { dir, sha, branch };
  }

  if (!existsSync(path.join(dir, ".git"))) {
    await mkdir(path.dirname(dir), { recursive: true });
    await exec("git", [...githubAuth(repo.location), "clone", "--quiet", "--no-tags", "--filter=blob:none", repo.location, dir], {
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    }).catch((err: Error) => {
      const hint = process.env.GITHUB_TOKEN ? "Does the GitHub token have access to it?" : "Is it public? For a private repo, set GITHUB_TOKEN.";
      throw new Error(`Could not clone ${repo.name}. ${hint}`);
    });
  } else {
    await git(dir, [...githubAuth(repo.location), "fetch", "--quiet", "--no-tags", "origin"]);
  }

  let branch = opts.branch;
  if (!branch) {
    const head = await git(dir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => "origin/main");
    branch = head.trim().replace(/^origin\//, "") || "main";
  }
  const sha = opts.sha ?? (await git(dir, ["rev-parse", `origin/${branch}`])).trim();
  // Fail loudly if a webhook names a commit we can't see.
  await git(dir, ["cat-file", "-e", `${sha}^{commit}`]);
  return { dir, sha, branch };
}

/** Read the analysable source files at `sha` straight from git objects. */
export async function snapshotRepo(
  repo: RepoRef,
  dir: string,
  sha: string,
  branch?: string,
): Promise<RepoSnapshot> {
  const tree = (await git(dir, ["ls-tree", "-r", "-l", "--full-tree", sha]))
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      // "<mode> <type> <object> <size>\t<path>"
      const [meta, p] = line.split("\t");
      const parts = meta.trim().split(/\s+/);
      return { path: p, object: parts[2], size: Number(parts[3]) || 0, type: parts[1] };
    })
    .filter((e) => e.type === "blob");

  const wanted = tree.filter((e) => e.size <= MAX_FILE_BYTES && isSourcePath(e.path));
  const contents = await readBlobs(dir, wanted.map((e) => e.object));

  const files: RepoFile[] = [];
  wanted.forEach((e, i) => {
    const content = contents[i];
    if (content === undefined || content.includes("\u0000")) return; // binary
    files.push({
      path: e.path,
      content,
      lines: content.split("\n").length,
      tokens: Math.ceil(content.length / 4),
    });
  });

  return {
    repo,
    sha,
    branch,
    tree: tree.map((e) => e.path),
    files,
    totalTokens: files.reduce((n, f) => n + f.tokens, 0),
  };
}

/** Batch-read blobs with one `git cat-file --batch` process. */
async function readBlobs(dir: string, objects: string[]): Promise<(string | undefined)[]> {
  if (objects.length === 0) return [];
  const out = await new Promise<Buffer>((resolve, reject) => {
    const child = execFile("git", ["cat-file", "--batch"], { cwd: dir, encoding: "buffer", maxBuffer: 512 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout as unknown as Buffer),
    );
    child.stdin?.end(objects.join("\n") + "\n");
  });
  const result: (string | undefined)[] = [];
  let pos = 0;
  for (let i = 0; i < objects.length; i++) {
    const nl = out.indexOf(0x0a, pos);
    if (nl < 0) break;
    const header = out.subarray(pos, nl).toString();
    pos = nl + 1;
    const m = header.match(/^\S+ blob (\d+)$/);
    if (!m) {
      result.push(undefined); // "missing"
      continue;
    }
    const size = Number(m[1]);
    result.push(out.subarray(pos, pos + size).toString("utf8"));
    pos += size + 1; // trailing newline
  }
  return result;
}

/** Files changed between two commits, with per-file unified diffs. */
export async function diffCommits(dir: string, fromSha: string, toSha: string): Promise<ChangedFile[]> {
  const nameStatus = await git(dir, ["diff", "--name-status", "-M", fromSha, toSha]);
  const changed: ChangedFile[] = [];
  for (const line of nameStatus.split("\n").filter(Boolean)) {
    const [code, a, b] = line.split("\t");
    const status = code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : code.startsWith("R") ? "renamed" : "modified";
    const p = status === "renamed" ? b : a;
    if (!isSourcePath(p) && !(status === "renamed" && isSourcePath(a))) continue;
    let patch = await git(dir, ["diff", "--unified=3", fromSha, toSha, "--", ...(status === "renamed" ? [a, b] : [p])]);
    if (patch.length > MAX_PATCH_CHARS) patch = patch.slice(0, MAX_PATCH_CHARS) + "\n… (diff truncated)";
    changed.push({ path: p, status, ...(status === "renamed" ? { previousPath: a } : {}), patch });
  }
  return changed;
}

/** Commits in (fromSha, toSha], newest first. */
export async function listCommits(dir: string, fromSha: string, toSha: string): Promise<CommitInfo[]> {
  const out = await git(dir, ["log", "--format=%H%x1f%an%x1f%s", `${fromSha}..${toSha}`]).catch(() => "");
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, author, message] = l.split("\x1f");
      return { sha, author, message };
    });
}

/** Prefix every line with its 1-based number: how agents cite evidence. */
export function numberLines(content: string): string {
  const lines = content.split("\n");
  const width = String(lines.length).length;
  return lines.map((l, i) => `${String(i + 1).padStart(width, " ")}| ${l}`).join("\n");
}
