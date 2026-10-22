// Builds the provenance USL in Zetaris over the Postgres evidence store.
//   npm run zetaris:setup
// Safe to re-run: existing objects are kept, tables are re-activated.
import { runSql, ZetarisError } from "../src/zetaris/client";
import {
  activateStatements, compileStatement, DATASOURCE, datasourceStatement, dqRules, NAMESPACE, TABLE_DESCRIPTIONS, TABLES, USL,
} from "../src/zetaris/usl";

const log = (m: string) => console.log(`[zetaris] ${m}`);
const exists = (e: unknown) => e instanceof ZetarisError && /already exist|exists|duplicate/i.test(e.message);

async function step(label: string, sql: string, opts: { quiet?: boolean; tolerateExisting?: boolean } = {}) {
  try {
    const result = await runSql(sql);
    log(`ok   ${label}`);
    return result;
  } catch (error) {
    if (opts.tolerateExisting && exists(error)) {
      log(`skip ${label} (already there)`);
      return undefined;
    }
    // The datasource statement carries the store's password: never echo it.
    throw new Error(`${label} failed: ${opts.quiet ? "(statement hidden)" : ""} ${error instanceof Error ? error.message : error}`);
  }
}

await step("connection", "SELECT 1 AS one");

const pgUrl = process.env.CARTOGRAPH_PG_URL;
if (!pgUrl) throw new Error("CARTOGRAPH_PG_URL is not set");
const sources = await runSql("SHOW DATASOURCES");
const registered = sources.rows.some((r) => r.some((v) => String(v).toLowerCase() === DATASOURCE));
if (!registered) {
  await step(`datasource ${DATASOURCE}`, datasourceStatement(pgUrl, process.env.CARTOGRAPH_PG_ZETARIS_HOST ?? "cartograph-pg:5432"), { quiet: true });
} else log(`skip datasource ${DATASOURCE} (already there)`);
await step("register evidence tables", `REGISTER DATASOURCE TABLES FROM ${DATASOURCE}`, { tolerateExisting: true });

// Postgres tables live in the public schema; find the name Zetaris gave them.
const candidates = [DATASOURCE, `${DATASOURCE}.public`];
let source: string | undefined;
for (const c of candidates) {
  try {
    await runSql(`SELECT COUNT(*) FROM ${c}.repository`);
    source = c;
    break;
  } catch {
    /* try the next naming */
  }
}
if (!source) {
  const tables = await runSql(`SHOW DATASOURCE TABLES ${DATASOURCE}`).catch((e) => ({ columns: [], rows: [[String(e)]] }));
  console.table(tables.rows.slice(0, 20));
  throw new Error(`Could not find the evidence tables under ${candidates.join(" or ")}; see the list above`);
}
log(`evidence tables are ${source}.*`);

await step("namespace lightning.metastore", "CREATE NAMESPACE IF NOT EXISTS lightning.metastore", { tolerateExisting: true });
await step(`namespace ${NAMESPACE}`, `CREATE NAMESPACE IF NOT EXISTS ${NAMESPACE}`, { tolerateExisting: true });
await step(`compile USL ${USL}`, compileStatement(), { tolerateExisting: true });

for (const { table, sql } of activateStatements(source)) await step(`activate ${table}`, sql);

await step("describe USL", `UPDATE USL ${NAMESPACE}.${USL} SET DESCRIPTION Code provenance: which commit, pull request and issue explain each line of code`);
for (const table of TABLES) {
  await step(`describe ${table}`, `UPDATE USL ${NAMESPACE}.${USL}.${table} SET TABLE DESCRIPTION ${TABLE_DESCRIPTIONS[table]}`);
}

for (const rule of dqRules()) {
  await step(`dq rule ${rule.name}`, `REGISTER DQ ${rule.name} TABLE ${NAMESPACE}.${USL}.${rule.table} AS ${rule.expression}`, { tolerateExisting: true });
  const result = await step(`run ${rule.name}`, `RUN DQ ${rule.name} TABLE ${NAMESPACE}.${USL}.${rule.table}`);
  if (result) console.table(result.rows.map((r) => Object.fromEntries(result.columns.map((c, i) => [c, r[i]]))));
}

for (const table of TABLES) {
  const { rows } = await runSql(`SELECT COUNT(*) FROM ${NAMESPACE}.${USL}.${table}`);
  log(`${table.padEnd(13)} ${rows[0]?.[0]} rows`);
}
