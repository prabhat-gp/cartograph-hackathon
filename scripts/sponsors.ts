// Live status of every sponsor integration, for setup checks and the demo.
//   npm run sponsors
import { DEFAULT_BASE_URL, autoDetect, normalizeBaseUrl, probeRuntime } from "../src/meterless/runtime";
import { runSql, zetarisConfig } from "../src/zetaris/client";

type Row = { sponsor: string; status: "ok" | "todo" | "fail"; detail: string };
const rows: Row[] = [];

async function check(sponsor: string, fn: () => Promise<Omit<Row, "sponsor">>) {
  try {
    rows.push({ sponsor, ...(await fn()) });
  } catch (error) {
    rows.push({ sponsor, status: "fail", detail: error instanceof Error ? error.message : String(error) });
  }
}

await check("NVIDIA Nemotron", async () => {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) return { status: "todo", detail: "set NVIDIA_API_KEY" };
  const base = process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
  const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return { status: "fail", detail: `GET /models answered ${res.status}` };
  const ids = ((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id).filter((id) => id.includes("nemotron"));
  return { status: "ok", detail: `${ids.length} Nemotron models available` };
});

await check("Meterless Nightshift", async () => {
  const token = process.env.METERLESS_API_KEY;
  if (!token) return { status: "todo", detail: "provider code ready; set METERLESS_API_KEY from Nightshift's Console" };
  const health = process.env.METERLESS_BASE_URL
    ? await probeRuntime(normalizeBaseUrl(process.env.METERLESS_BASE_URL), token)
    : (await autoDetect(token)) ?? (await probeRuntime(DEFAULT_BASE_URL, token));
  return { status: health.state === "online" ? "ok" : "fail", detail: `${health.state} at ${health.baseUrl}: ${health.reason}` };
});

await check("Zetaris", async () => {
  if (!process.env.ZETARIS_API_KEY) return { status: "todo", detail: "set ZETARIS_API_KEY (Zetaris web interface → API keys)" };
  const config = zetarisConfig();
  const one = await runSql("SELECT 1 AS one", { config });
  const dbs = await runSql("SHOW LIGHTNING DATABASES", { config });
  return { status: String(one.rows[0]?.[0]) === "1" ? "ok" : "fail", detail: `SELECT 1 ok, ${dbs.rows.length} Lightning databases` };
});

rows.push({ sponsor: "Cursor", status: "ok", detail: "development environment (free plan); see README" });

for (const r of rows) console.log(`${r.status === "ok" ? "OK  " : r.status === "todo" ? "TODO" : "FAIL"}  ${r.sponsor.padEnd(22)} ${r.detail}`);
process.exitCode = rows.some((r) => r.status === "fail") ? 1 : 0;
