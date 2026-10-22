// Reads a repository's history from a local clone: commits with the files
// they touched, and git blame at head collapsed into line ranges.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

/** Where local clones live: .cartograph/repos unless CARTOGRAPH_REPOS_DIR says otherwise. */
export function reposDir(): string {
  return process.env.CARTOGRAPH_REPOS_DIR ?? path.join(process.cwd(), ".cartograph", "repos");
}

export function cloneDir(repo: string): string {
  return path.join(reposDir(), repo.replace("/", "__"));
}

/** Clones (or fetches) owner/name under reposDir() and returns the path. */
export async function syncClone(repo: string, root = reposDir()): Promise<string> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`Not an owner/name repository: ${repo}`);
  const dir = path.join(root, repo.replace("/", "__"));
  if (existsSync(path.join(dir, ".git"))) {
    await git(dir, ["fetch", "--quiet", "origin"]);
    await git(dir, ["reset", "--quiet", "--hard", "origin/HEAD"]);
  } else {
    mkdirSync(root, { recursive: true });
    await run("git", ["clone", "--quiet", `https://github.com/${repo}.git`, dir], { maxBuffer: 64 * 1024 * 1024 });
  }
  return dir;
}

export async function headInfo(dir: string): Promise<{ sha: string; branch: string }> {
  const sha = (await git(dir, ["rev-parse", "HEAD"])).trim();
  const ref = (await git(dir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => "origin/main")).trim();
  return { sha, branch: ref.replace(/^origin\//, "") };
}

export interface CommitRecord {
  sha: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
  body: string;
  files: { path: string; additions: number; deletions: number }[];
}

const FIELD = "\x1f";
const RECORD = "\x1e";

/** Last `limit` commits on the current branch, newest first, with per-file line counts. */
export async function readCommits(dir: string, limit: number): Promise<CommitRecord[]> {
  const out = await git(dir, ["log", `-n${limit}`, "--numstat", `--format=${RECORD}%H${FIELD}%an${FIELD}%ae${FIELD}%aI${FIELD}%s${FIELD}%b${FIELD}`]);
  return parseLog(out);
}

export function parseLog(out: string): CommitRecord[] {
  return out
    .split(RECORD)
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [sha, authorName, authorEmail, authoredAt, subject, body, stats] = chunk.split(FIELD);
      const files = (stats ?? "")
        .split("\n")
        .map((line) => line.split("\t"))
        .filter((parts) => parts.length === 3)
        .map(([add, del, file]) => ({
          path: renamedTarget(file),
          additions: Number(add) || 0, // "-" for binary files
          deletions: Number(del) || 0,
        }));
      return { sha, authorName, authorEmail, authoredAt, subject, body: body.trim(), files };
    });
}

/** numstat writes renames as "a/{old => new}/b" or "old => new"; keep the new path. */
export function renamedTarget(file: string): string {
  const braced = file.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braced) return `${braced[1]}${braced[3]}${braced[4]}`.replace(/\/\//g, "/");
  const plain = file.split(" => ");
  return plain.length === 2 ? plain[1] : file;
}

const SOURCE_EXT: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java", ".kt": "Kotlin", ".rb": "Ruby", ".php": "PHP",
  ".c": "C", ".h": "C", ".cc": "C++", ".cpp": "C++", ".hpp": "C++", ".cs": "C#", ".swift": "Swift", ".scala": "Scala",
  ".sql": "SQL", ".sh": "Shell", ".md": "Markdown", ".yml": "YAML", ".yaml": "YAML", ".toml": "TOML",
};

export interface SourceFile {
  path: string;
  language: string;
  lines: number;
}

/** Tracked text files worth explaining, skipping vendored, generated and huge files. */
export async function listSourceFiles(dir: string, maxLines = 5000): Promise<SourceFile[]> {
  const paths = (await git(dir, ["ls-files"])).split("\n").filter(Boolean);
  const files: SourceFile[] = [];
  for (const p of paths) {
    const language = SOURCE_EXT[path.extname(p).toLowerCase()];
    if (!language) continue;
    if (/(^|\/)(node_modules|vendor|dist|build|third_party)\//.test(p) || /\.min\.|lock\b|\.lock$/.test(p)) continue;
    const full = path.join(dir, p);
    if (!existsSync(full) || statSync(full).size > 1_000_000) continue;
    const text = readFileSync(full, "utf8");
    const lines = text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
    if (lines === 0 || lines > maxLines) continue;
    files.push({ path: p, language, lines });
  }
  return files;
}

export interface LineRange {
  lineStart: number;
  lineEnd: number;
  commitSha: string;
}

/** git blame --porcelain at HEAD, collapsed into consecutive ranges per commit. */
export async function blameRanges(dir: string, file: string): Promise<LineRange[]> {
  const out = await git(dir, ["blame", "--porcelain", "HEAD", "--", file]);
  return collapseBlame(out);
}

export function collapseBlame(porcelain: string): LineRange[] {
  const ranges: LineRange[] = [];
  for (const line of porcelain.split("\n")) {
    const m = line.match(/^([0-9a-f]{40}) \d+ (\d+) (\d+)$/);
    if (!m) continue;
    const [, sha, start, count] = m;
    const lineStart = Number(start);
    const lineEnd = lineStart + Number(count) - 1;
    const last = ranges.at(-1);
    if (last && last.commitSha === sha && last.lineEnd + 1 === lineStart) last.lineEnd = lineEnd;
    else ranges.push({ lineStart, lineEnd, commitSha: sha });
  }
  return ranges;
}

/** The same fields as readCommits for specific commits, read in batches. */
export async function readCommitsBySha(dir: string, shas: string[]): Promise<CommitRecord[]> {
  const out: CommitRecord[] = [];
  for (let i = 0; i < shas.length; i += 200) {
    const batch = shas.slice(i, i + 200);
    const text = await git(dir, ["show", "--no-walk=unsorted", "--numstat", `--format=${RECORD}%H${FIELD}%an${FIELD}%ae${FIELD}%aI${FIELD}%s${FIELD}%b${FIELD}`, ...batch]);
    out.push(...parseLog(text));
  }
  return out;
}
