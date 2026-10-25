// Which AI provider the agents talk to. Meterless Nightshift is the primary
// provider; NVIDIA's API is the direct route used while Nightshift isn't
// running. Both speak the OpenAI chat completions API.
import { DEFAULT_BASE_URL, normalizeBaseUrl } from "./meterless/runtime";

export type ProviderName = "meterless" | "nvidia";
/** Agents ask for a tier; each provider maps it to a model. */
/** fast: bulk reading · mid: planning and drawing the map · deep: judging answers. */
export type Tier = "fast" | "mid" | "deep";

export interface ProviderConfig {
  name: ProviderName;
  baseUrl: string;
  apiKey: string;
}

const MODELS: Record<ProviderName, Record<Tier, string>> = {
  meterless: { fast: "meterless/fast", mid: "meterless/auto", deep: "meterless/deep" },
  nvidia: { fast: "nvidia/nemotron-3.5-lightning-30b-a3b", mid: "nvidia/nemotron-3.5-super-vl-120b-a12b", deep: "nvidia/nemotron-3-ultra-550b-a55b" },
};

export function modelFor(provider: ProviderName, tier: Tier, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[`CARTOGRAPH_${provider.toUpperCase()}_${tier.toUpperCase()}_MODEL`];
  return override || MODELS[provider][tier];
}

function nvidia(env: NodeJS.ProcessEnv): ProviderConfig {
  if (!env.NVIDIA_API_KEY) throw new Error("NVIDIA_API_KEY is not set");
  return { name: "nvidia", baseUrl: env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1", apiKey: env.NVIDIA_API_KEY };
}

export function providerConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const forced = env.CARTOGRAPH_PROVIDER || undefined;
  if (forced && forced !== "meterless" && forced !== "nvidia") {
    throw new Error(`CARTOGRAPH_PROVIDER must be "meterless" or "nvidia", got "${forced}"`);
  }
  const name: ProviderName = (forced as ProviderName | undefined) ?? (env.METERLESS_API_KEY ? "meterless" : "nvidia");
  if (name === "nvidia") return nvidia(env);
  if (!env.METERLESS_API_KEY) throw new Error("METERLESS_API_KEY is not set (Nightshift Console → API key)");
  if (env.METERLESS_API_KEY === "rt-local") throw new Error("METERLESS_API_KEY is the rt-local placeholder; the runtime rejects it");
  return { name, baseUrl: normalizeBaseUrl(env.METERLESS_BASE_URL || DEFAULT_BASE_URL), apiKey: env.METERLESS_API_KEY };
}

/** NVIDIA direct, used only when Meterless is primary and the runtime can't be reached. */
export function fallbackProvider(primary: ProviderConfig, env: NodeJS.ProcessEnv = process.env): ProviderConfig | undefined {
  if (primary.name !== "meterless" || !env.NVIDIA_API_KEY) return undefined;
  return nvidia(env);
}

/** Which provider and models the agents run on, for logs and the UI. */
export function runtimeLabel(env: NodeJS.ProcessEnv = process.env): string {
  try {
    const p = providerConfig(env);
    const via = p.name === "meterless" ? "Meterless Nightshift" : "NVIDIA";
    return `${modelFor(p.name, "mid", env)} + ${modelFor(p.name, "fast", env)} + ${modelFor(p.name, "deep", env)} via ${via}`;
  } catch (error) {
    return `no model provider (${error instanceof Error ? error.message : error})`;
  }
}
