// Ingests a GitHub repository into the evidence store.
//   npm run ingest -- owner/name [--commits 400] [--prs 150] [--blame 150]
import { execFileSync } from "node:child_process";
import { ingestRepository } from "../src/ingest";
import { syncClone } from "../src/ingest/git";
import { closeDb, db, migrate } from "../src/store/pg";

const args = process.argv.slice(2);
const repo = args.find((a) => !a.startsWith("--"));
if (!repo) {
  console.error("usage: npm run ingest -- owner/name [--commits N] [--prs N] [--blame N]");
  process.exit(2);
}
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};

// A token from the environment, or the GitHub CLI's login if there is one.
const token = process.env.GITHUB_TOKEN || (() => {
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
})();
if (!token) {
  console.error("Set GITHUB_TOKEN (or sign in with the GitHub CLI): the GraphQL API needs a token.");
  process.exit(2);
}

const started = Date.now();
await migrate();
const summary = await ingestRepository(db(), { id: repo, dir: await syncClone(repo), github: repo }, {
  commits: flag("commits", 400),
  pullRequests: flag("prs", 150),
  blameFiles: flag("blame", 150),
  githubToken: token,
  log: (m) => console.log(`[ingest] ${m}`),
});
console.table(summary);
console.log(`[ingest] ${((Date.now() - started) / 1000).toFixed(1)}s`);
await closeDb();
