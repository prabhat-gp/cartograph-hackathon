import { describe, expect, it } from "vitest";
import { fallbackProvider, modelFor, providerConfig } from "../src/config";

describe("providerConfig", () => {
  it("prefers Meterless when its token is set", () => {
    const p = providerConfig({ METERLESS_API_KEY: "m", NVIDIA_API_KEY: "n" });
    expect(p).toEqual({ name: "meterless", baseUrl: "http://127.0.0.1:8088/v1", apiKey: "m" });
  });

  it("falls back to NVIDIA directly", () => {
    const p = providerConfig({ NVIDIA_API_KEY: "n" });
    expect(p.name).toBe("nvidia");
    expect(p.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
  });

  it("honours CARTOGRAPH_PROVIDER", () => {
    expect(providerConfig({ CARTOGRAPH_PROVIDER: "nvidia", METERLESS_API_KEY: "m", NVIDIA_API_KEY: "n" }).name).toBe("nvidia");
  });

  it("normalises the runtime URL and rejects the rt-local placeholder", () => {
    expect(providerConfig({ METERLESS_API_KEY: "m", METERLESS_BASE_URL: "127.0.0.1:8090/v1/models" }).baseUrl).toBe("http://127.0.0.1:8090/v1");
    expect(() => providerConfig({ METERLESS_API_KEY: "rt-local" })).toThrow("rt-local");
  });

  it("maps tiers to models per provider, with overrides", () => {
    expect(modelFor("meterless", "deep", {})).toBe("meterless/deep");
    expect(modelFor("nvidia", "fast", {})).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(modelFor("nvidia", "deep", { CARTOGRAPH_NVIDIA_DEEP_MODEL: "nvidia/x" })).toBe("nvidia/x");
  });

  it("offers NVIDIA as fallback only behind Meterless", () => {
    const env = { METERLESS_API_KEY: "m", NVIDIA_API_KEY: "n" };
    expect(fallbackProvider(providerConfig(env), env)?.name).toBe("nvidia");
    expect(fallbackProvider(providerConfig({ NVIDIA_API_KEY: "n" }), { NVIDIA_API_KEY: "n" })).toBeUndefined();
  });

  it("fails clearly without keys", () => {
    expect(() => providerConfig({})).toThrow("NVIDIA_API_KEY");
    expect(() => providerConfig({ CARTOGRAPH_PROVIDER: "meterless" })).toThrow("METERLESS_API_KEY");
  });
});
