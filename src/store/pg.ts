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
