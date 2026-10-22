// Which AI provider the agents talk to. Meterless Nightshift is the primary
// provider; NVIDIA's API is the direct route used while Nightshift isn't
// running. Both speak the OpenAI chat completions API.
export type ProviderName = "meterless" | "nvidia";

export interface ProviderConfig {
  name: ProviderName;
  baseUrl: string;
  apiKey: string;
}

export function providerConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const forced = env.CARTOGRAPH_PROVIDER;
  if (forced && forced !== "meterless" && forced !== "nvidia") {
    throw new Error(`CARTOGRAPH_PROVIDER must be "meterless" or "nvidia", got "${forced}"`);
  }
  const name: ProviderName = (forced as ProviderName | undefined) ?? (env.METERLESS_API_KEY ? "meterless" : "nvidia");
  if (name === "meterless") {
    if (!env.METERLESS_API_KEY) throw new Error("METERLESS_API_KEY is not set (Nightshift proxy token)");
    return { name, baseUrl: env.METERLESS_BASE_URL ?? "http://127.0.0.1:8088/v1", apiKey: env.METERLESS_API_KEY };
  }
  if (!env.NVIDIA_API_KEY) throw new Error("NVIDIA_API_KEY is not set");
  return { name, baseUrl: env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1", apiKey: env.NVIDIA_API_KEY };
}
