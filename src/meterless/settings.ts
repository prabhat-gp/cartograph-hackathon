// The desk's Meterless settings: a pasted connect link, base URL or token is
// saved next to the maps and applied to this process, so Nightshift becomes
// the primary provider without editing .env or restarting.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir } from "../server/store";
import { DEFAULT_BASE_URL, type RuntimeHealth, autoDetect, normalizeBaseUrl, parseConnectLink, probeRuntime } from "./runtime";

interface Saved {
  base_url: string;
  meterless_runtime_token: string;
}

const file = () => path.join(dataDir(), "meterless.json");

function apply(saved: Saved | null, env: NodeJS.ProcessEnv) {
  if (saved) {
    env.METERLESS_BASE_URL = saved.base_url;
    env.METERLESS_API_KEY = saved.meterless_runtime_token;
  } else {
    delete env.METERLESS_BASE_URL;
    delete env.METERLESS_API_KEY;
  }
}

/** At startup: settings saved from the desk win over .env, the same as when they were saved. */
export function loadMeterlessSettings(env: NodeJS.ProcessEnv = process.env) {
  if (!existsSync(file())) return;
  try {
    apply(JSON.parse(readFileSync(file(), "utf8")) as Saved, env);
  } catch {
    console.warn("[meterless] ignoring an unreadable meterless.json");
  }
}

export interface MeterlessSettings {
  baseUrl: string;
  /** Last four characters only; the token itself never leaves the server. */
  token: string | null;
}

export function currentSettings(env: NodeJS.ProcessEnv = process.env): MeterlessSettings {
  const token = env.METERLESS_API_KEY;
  return {
    baseUrl: normalizeBaseUrl(env.METERLESS_BASE_URL || DEFAULT_BASE_URL),
    token: token ? `…${token.slice(-4)}` : null,
  };
}

export class SettingsError extends Error {}

/**
 * One field takes a connect link or a base URL; a link carries its own token.
 * Saved only when the runtime answers online, so a wrong token can't switch
 * the agents to a provider that refuses them.
 */
export async function connect(input: { address?: string; token?: string }, env: NodeJS.ProcessEnv = process.env, doFetch: typeof fetch = fetch): Promise<RuntimeHealth> {
  const address = input.address?.trim() ?? "";
  const link = parseConnectLink(address);
  const token = link?.apiKey ?? (input.token?.trim() || env.METERLESS_API_KEY || "");
  if (!token) throw new SettingsError("Paste the runtime's access token, or a connect link that carries it.");
  if (token === "rt-local") throw new SettingsError("rt-local is a placeholder the runtime rejects. Copy the token from Nightshift's Console.");
  const baseUrl = link?.baseUrl ?? normalizeBaseUrl(address || env.METERLESS_BASE_URL || DEFAULT_BASE_URL);
  const health = await probeRuntime(baseUrl, token, doFetch);
  if (health.state === "online") save({ base_url: baseUrl, meterless_runtime_token: token }, env);
  return health;
}

/** Tries the usual local ports; saves the runtime it finds when the token works there. */
export async function detect(input: { token?: string }, env: NodeJS.ProcessEnv = process.env, doFetch: typeof fetch = fetch): Promise<RuntimeHealth | null> {
  const token = input.token?.trim() || env.METERLESS_API_KEY || "";
  const health = await autoDetect(token, doFetch);
  if (health?.state === "online") save({ base_url: health.baseUrl, meterless_runtime_token: token }, env);
  return health;
}

/** Back to NVIDIA direct. */
export function disconnect(env: NodeJS.ProcessEnv = process.env) {
  rmSync(file(), { force: true });
  apply(null, env);
}

function save(saved: Saved, env: NodeJS.ProcessEnv) {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(file(), JSON.stringify(saved, null, 2), { mode: 0o600 });
  apply(saved, env);
}
