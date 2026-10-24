import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { SettingsError, connect, currentSettings, detect, disconnect, loadMeterlessSettings } from "../src/meterless/settings";

const online = (async () => new Response(JSON.stringify({ data: [{ id: "meterless/auto" }] }), { status: 200 })) as unknown as typeof fetch;
const rejects = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
const savedFile = () => path.join(process.env.CARTOGRAPH_DATA_DIR!, "meterless.json");

describe("Meterless settings from the desk", () => {
  let env: NodeJS.ProcessEnv;
  beforeEach(() => {
    process.env.CARTOGRAPH_DATA_DIR = mkdtempSync(path.join(tmpdir(), "cartograph-meterless-"));
    env = {};
  });

  it("a pasted connect link configures the provider and is saved privately", async () => {
    const health = await connect({ address: "http://192.168.1.5:8088/connect#k=secret-1234" }, env, online);
    expect(health.state).toBe("online");
    expect(env.METERLESS_BASE_URL).toBe("http://192.168.1.5:8088/v1");
    expect(env.METERLESS_API_KEY).toBe("secret-1234");
    expect(JSON.parse(readFileSync(savedFile(), "utf8"))).toEqual({ base_url: "http://192.168.1.5:8088/v1", meterless_runtime_token: "secret-1234" });
    expect(statSync(savedFile()).mode & 0o777).toBe(0o600);
    expect(currentSettings(env)).toEqual({ baseUrl: "http://192.168.1.5:8088/v1", token: "…1234" });
  });

  it("a bare base URL is a base URL, with the token from its own field", async () => {
    await connect({ address: "127.0.0.1:8090", token: "tok" }, env, online);
    expect(env.METERLESS_BASE_URL).toBe("http://127.0.0.1:8090/v1");
  });

  it("a wrong token reports unauthorized and changes nothing", async () => {
    const health = await connect({ address: "127.0.0.1:8088", token: "wrong" }, env, rejects);
    expect(health.state).toBe("unauthorized");
    expect(env.METERLESS_API_KEY).toBeUndefined();
    expect(existsSync(savedFile())).toBe(false);
  });

  it("refuses no token and the rt-local placeholder", async () => {
    await expect(connect({ address: "127.0.0.1:8088" }, env, online)).rejects.toThrow(SettingsError);
    await expect(connect({ token: "rt-local" }, env, online)).rejects.toThrow(/placeholder/);
  });

  it("auto detect saves the runtime it finds", async () => {
    const health = await detect({ token: "tok" }, env, online);
    expect(health?.state).toBe("online");
    expect(env.METERLESS_BASE_URL).toBe("http://127.0.0.1:8088/v1");
  });

  it("saved settings come back after a restart, and disconnect forgets them", async () => {
    await connect({ address: "http://h:1/connect#k=abc" }, env, online);
    const restarted: NodeJS.ProcessEnv = {};
    loadMeterlessSettings(restarted);
    expect(restarted.METERLESS_API_KEY).toBe("abc");
    disconnect(restarted);
    expect(restarted.METERLESS_API_KEY).toBeUndefined();
    expect(existsSync(savedFile())).toBe(false);
  });
});
