import { describe, expect, it } from "vitest";
import { providerConfig } from "../src/config";

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

  it("fails clearly without keys", () => {
    expect(() => providerConfig({})).toThrow("NVIDIA_API_KEY");
    expect(() => providerConfig({ CARTOGRAPH_PROVIDER: "meterless" })).toThrow("METERLESS_API_KEY");
  });
});
