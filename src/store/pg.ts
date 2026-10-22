// Postgres evidence store. One pool per process; schema files in
// sql/postgres are applied in order and are idempotent.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

let pool: pg.Pool | undefined;

export function db(url = process.env.CARTOGRAPH_PG_URL): pg.Pool {
  if (!url) throw new Error("CARTOGRAPH_PG_URL is not set");
  pool ??= new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 10_000 });
  return pool;
}

export async function migrate(client: pg.Pool = db()): Promise<string[]> {
  const dir = path.join(process.cwd(), "sql", "postgres");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await client.query(readFileSync(path.join(dir, f), "utf8"));
  return files;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** Inserts rows in batches; on conflict with the primary key the row is updated. */
export async function upsert(
  client: pg.Pool | pg.PoolClient,
  table: string,
  key: string[],
  rows: Record<string, unknown>[],
  batch = 500,
): Promise<void> {
  if (rows.length === 0) return;
  // Postgres refuses to update the same row twice in one statement: keep the last.
  rows = [...new Map(rows.map((r) => [key.map((k) => String(r[k])).join("\u0000"), r])).values()];
  const cols = Object.keys(rows[0]);
  const updates = cols.filter((c) => !key.includes(c)).map((c) => `${c} = EXCLUDED.${c}`);
  const conflict = updates.length ? `DO UPDATE SET ${updates.join(", ")}` : "DO NOTHING";
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const values: unknown[] = [];
    const tuples = chunk.map((row) => `(${cols.map((c) => (values.push(row[c] ?? null), `$${values.length}`)).join(", ")})`);
    await client.query(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES ${tuples.join(", ")} ON CONFLICT (${key.join(", ")}) ${conflict}`,
      values,
    );
  }
}

/**
 * Recomputes the denormalised link columns for one repository. A commit's
 * own pull request is the one its squash subject names, "Fix x (#123)";
 * failing that, the smallest pull request that contains it, so a release
 * branch merge with hundreds of commits doesn't claim them all.
 */
export async function refreshDerived(client: pg.Pool, repo: string): Promise<void> {
  await client.query(
    `WITH sizes AS (SELECT pr_id, COUNT(*) AS n FROM pr_commit GROUP BY pr_id),
     by_subject AS (
       SELECT c.sha, p.id AS pr_id FROM git_commit c
       JOIN pull_request p ON p.repo_id = c.repo_id
        AND p.number = CAST(substring(c.subject from '\\(#([0-9]+)\\)\\s*$') AS integer)
       WHERE c.repo_id = $1
     ),
     by_membership AS (
       SELECT DISTINCT ON (pc.commit_sha) pc.commit_sha AS sha, pc.pr_id
       FROM pr_commit pc JOIN sizes s ON s.pr_id = pc.pr_id
       JOIN git_commit c ON c.sha = pc.commit_sha AND c.repo_id = $1
       ORDER BY pc.commit_sha, s.n, pc.pr_id
     )
     UPDATE git_commit c SET pr_id = COALESCE(bs.pr_id, bm.pr_id)
     FROM git_commit c2
     LEFT JOIN by_subject bs ON bs.sha = c2.sha
     LEFT JOIN by_membership bm ON bm.sha = c2.sha
     WHERE c.sha = c2.sha AND c.repo_id = $1`,
    [repo],
  );
  await client.query(
    `UPDATE pull_request p SET
       issue_count = (SELECT COUNT(*) FROM pr_issue pi WHERE pi.pr_id = p.id),
       discussion_count = (SELECT COUNT(*) FROM discussion d WHERE d.parent_id = p.id)
     WHERE p.repo_id = $1`,
    [repo],
  );
}
