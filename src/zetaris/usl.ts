// The provenance Unified Semantic Layer: the Postgres evidence store
// registered in Zetaris as a JDBC datasource, modelled as one USL with keys
// and relationships, and checked with data-quality rules. Every statement
// here is idempotent so setup can be re-run after each ingest.
import { readFileSync } from "node:fs";
import path from "node:path";

export const NAMESPACE = "lightning.metastore.cartograph";
export const USL = "provenance";
export const DATASOURCE = "cartograph_pg";
export const TABLES = ["repository", "source_file", "code_change", "file_change", "line_origin", "pull_request", "issue", "pr_issue", "discussion"] as const;

const SQL_DIR = path.join(process.cwd(), "sql", "zetaris");

export const TABLE_DESCRIPTIONS: Record<(typeof TABLES)[number], string> = {
  repository: "One row per ingested GitHub repository, with the commit its code map was built from",
  source_file: "Source files at head, one row per path",
  code_change: "Git commits with the pull request that merged them, if any",
  file_change: "Which files each commit touched, with lines added and removed",
  line_origin: "git blame at head: which commit last changed each range of lines in a file",
  pull_request: "Merged pull requests with how many issues they link and how much discussion they had",
  issue: "Issues that pull requests close or mention: the stated reasons for changes",
  pr_issue: "Links from a pull request to an issue it closes or mentions",
  discussion: "Comments, reviews and inline review comments on pull requests and issues",
};

/** JDBC settings Zetaris uses to reach the evidence store from inside the Docker network. */
export function datasourceStatement(pgUrl: string, host: string): string {
  const url = new URL(pgUrl);
  const database = url.pathname.replace(/^\//, "");
  const quote = (s: string) => `"${decodeURIComponent(s).replace(/"/g, '\\"')}"`;
  return (
    `CREATE DATASOURCE ${DATASOURCE} DESCRIBE BY "Cartograph evidence store" OPTIONS (` +
    `jdbcdriver "org.postgresql.Driver", jdbcurl ${quote(`jdbc:postgresql://${host}/${database}`)}, ` +
    `username ${quote(url.username)}, password ${quote(url.password)}, fetchsize "1000")`
  );
}

export function compileStatement(): string {
  return readFileSync(path.join(SQL_DIR, "provenance_usl.sql"), "utf8").trim();
}

/** ACTIVATE statements, with ${source} bound to how Zetaris names the datasource's tables. */
export function activateStatements(source: string): { table: string; sql: string }[] {
  return TABLES.map((table) => {
    const query = readFileSync(path.join(SQL_DIR, "activate", `${table}.sql`), "utf8").replaceAll("${source}", source).trim();
    return { table, sql: `ACTIVATE USL TABLE ${NAMESPACE}.${USL}.${table} AS\n${query}` };
  });
}

export interface DqRule {
  name: string;
  table: string;
  expression: string;
}

export function dqRules(): DqRule[] {
  return readFileSync(path.join(SQL_DIR, "dq_rules.sql"), "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("--"))
    .map((line) => {
      const [name, table, expression] = line.split("|").map((s) => s.trim());
      return { name, table, expression };
    });
}
