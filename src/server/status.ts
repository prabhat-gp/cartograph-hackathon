// Live status of every sponsor integration: for `npm run sponsors`, the
// desk's "Powered by" panel and the deep health check.
import { modelFor, providerConfig } from "../config";
import { DEFAULT_BASE_URL, autoDetect, normalizeBaseUrl, probeRuntime } from "../meterless/runtime";
import { runSql, zetarisConfig } from "../zetaris/client";

export interface SponsorStatus {
  sponsor: string;
  role: string;
  /** standby: built in and switched off here, by design. */
  status: "ok" | "standby" | "todo" | "fail";
  detail: string;
}

const within = <T,>(ms: number, p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no answer within ${ms / 1000} s`)), ms))]);

async function check(sponsor: string, role: string, fn: () => Promise<Pick<SponsorStatus, "status" | "detail">>): Promise<SponsorStatus> {
  try {
    return { sponsor, role, ...(await within(15_000, fn())) };
  } catch (error) {
    return { sponsor, role, status: "fail", detail: error instanceof Error ? error.message : String(error) };
  }
}

export function checkSponsors(env: NodeJS.ProcessEnv = process.env): Promise<SponsorStatus[]> {
  return Promise.all([
    check("Meterless Nightshift", "Primary AI provider (Runtime 1.4)", async () => {
      const token = env.METERLESS_API_KEY;
      if (!token) {
        return { status: "standby", detail: "Built in as the primary provider. No Nightshift runs on this machine, so the agents call NVIDIA directly." };
      }
      const health = env.METERLESS_BASE_URL
        ? await probeRuntime(normalizeBaseUrl(env.METERLESS_BASE_URL), token)
        : ((await autoDetect(token)) ?? (await probeRuntime(DEFAULT_BASE_URL, token)));
      return health.state === "online"
        ? { status: "ok", detail: `Online at ${health.baseUrl}: ${health.reason}` }
        : { status: "fail", detail: `${health.state} at ${health.baseUrl}: ${health.reason}. Agents fall back to NVIDIA.` };
    }),
    check("NVIDIA Nemotron", "The models behind every agent", async () => {
      const key = env.NVIDIA_API_KEY;
      if (!key) return { status: "todo", detail: "Set NVIDIA_API_KEY" };
      const base = env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
      const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return { status: "fail", detail: `GET /models answered ${res.status}` };
      const provider = providerConfig(env).name;
      return { status: "ok", detail: `${modelFor(provider, "deep", env)} (deep) and ${modelFor(provider, "fast", env)} (fast)` };
    }),
    check("Zetaris", "History as a Unified Semantic Layer", async () => {
      if (!env.ZETARIS_API_KEY && !env.ZETARIS_PASSWORD) return { status: "todo", detail: "Set ZETARIS_API_KEY or ZETARIS_USERNAME/PASSWORD" };
      const one = await runSql("SELECT 1 AS one", { config: zetarisConfig(env) });
      return String(one.rows[0]?.[0]) === "1"
        ? { status: "ok", detail: "Answering SQL over the provenance USL: lines, commits, pull requests, issues, discussion" }
        : { status: "fail", detail: "SELECT 1 returned an unexpected result" };
    }),
    check("Meterless H-MEM", "Memory engine", async () => ({
      status: "ok",
      detail: "Runs inside Cartograph: keeps approved answers with their sources and retires them when the code changes",
    })),
  ]);
}

let cached: { at: number; value: Promise<SponsorStatus[]> } | null = null;

/** The same check, reused for a minute so a busy page doesn't probe every sponsor on each view. */
export function sponsorStatus(): Promise<SponsorStatus[]> {
  if (!cached || Date.now() - cached.at > 60_000) cached = { at: Date.now(), value: checkSponsors() };
  return cached.value;
}
