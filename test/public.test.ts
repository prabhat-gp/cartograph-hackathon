// Public mode (a hosted demo): visitors may only map public GitHub repos, and
// each visitor's expensive tool calls are limited per hour.
import type { Request } from "express";
import { describe, expect, it } from "vitest";

process.env.CARTOGRAPH_PUBLIC = "1";
const { assertPublicRepo, takeVisitorCall, withCaller } = await import("../src/server/security");

const visitor = { header: (name: string) => (name === "host" ? "cartograph.example" : undefined) } as unknown as Request;
const github = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

describe("public repos only", () => {
  it("lets a visitor map a public repo", async () => {
    await expect(withCaller(visitor, () => assertPublicRepo("sindresorhus/ky", github(200, { private: false })))).resolves.toBeUndefined();
  });

  it("refuses a private repo the server's token could read", async () => {
    await expect(withCaller(visitor, () => assertPublicRepo("me/secret", github(200, { private: true })))).rejects.toThrow(/public repositories only/);
  });

  it("refuses a repo GitHub doesn't show to anyone", async () => {
    await expect(withCaller(visitor, () => assertPublicRepo("me/hidden", github(404, { message: "Not Found" })))).rejects.toThrow(/isn't a public GitHub repository/);
  });

  it("doesn't ask GitHub for the owner's own local calls", async () => {
    const never = (async () => {
      throw new Error("should not be called");
    }) as typeof fetch;
    await expect(assertPublicRepo("me/secret", never)).resolves.toBeUndefined();
  });
});

describe("per-visitor limits", () => {
  it("allows three maps an hour per visitor, then refuses", () => {
    const now = Date.now();
    expect([1, 2, 3, 4].map(() => takeVisitorCall("203.0.113.7", "map_repo", now))).toEqual([true, true, true, false]);
    expect(takeVisitorCall("203.0.113.8", "map_repo", now)).toBe(true);
    expect(takeVisitorCall("203.0.113.7", "map_repo", now + 3_600_001)).toBe(true);
  });

  it("doesn't limit tools that spend nothing", () => {
    for (let i = 0; i < 100; i++) expect(takeVisitorCall("203.0.113.9", "cartograph_graph")).toBe(true);
  });
});
