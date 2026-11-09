import type { Request } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { visitorOf } from "../src/server/security";

const req = (headers: Record<string, string>, ip = "104.28.1.1") =>
  ({ ip, header: (name: string) => headers[name.toLowerCase()] }) as unknown as Request;

describe("visitorOf (workers.dev mirror)", () => {
  afterEach(() => {
    delete process.env.CARTOGRAPH_MIRROR_SECRET;
  });

  it("uses the connecting address by default", () => {
    expect(visitorOf(req({ "x-cartograph-client-ip": "1.2.3.4" }))).toBe("104.28.1.1");
  });

  it("trusts the mirror's client address only with the right secret", () => {
    process.env.CARTOGRAPH_MIRROR_SECRET = "s3cret";
    expect(visitorOf(req({ "x-cartograph-mirror": "s3cret", "x-cartograph-client-ip": "1.2.3.4" }))).toBe("1.2.3.4");
    expect(visitorOf(req({ "x-cartograph-mirror": "wrong", "x-cartograph-client-ip": "1.2.3.4" }))).toBe("104.28.1.1");
    expect(visitorOf(req({ "x-cartograph-client-ip": "1.2.3.4" }))).toBe("104.28.1.1");
  });

  it("ignores a client address that isn't an IP", () => {
    process.env.CARTOGRAPH_MIRROR_SECRET = "s3cret";
    expect(visitorOf(req({ "x-cartograph-mirror": "s3cret", "x-cartograph-client-ip": "evil, 1.2.3.4" }))).toBe("104.28.1.1");
  });
});
