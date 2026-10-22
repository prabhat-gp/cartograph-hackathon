import { describe, expect, it } from "vitest";
import { strictJsonSchema } from "../src/server/brain/codex";
import { CartographerSchema, ReaderSchema, ScoutSchema } from "../src/server/brain/schemas";

// Every object must list all its properties as required and forbid extras, and no
// keywords outside the structured-outputs subset may remain.
function check(node: unknown, path = "$"): void {
  if (Array.isArray(node)) return node.forEach((n, i) => check(n, `${path}[${i}]`));
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  for (const k of ["minimum", "exclusiveMinimum", "maximum", "minItems", "$schema", "default"]) expect(o[k], `${path}.${k}`).toBeUndefined();
  if (o.type === "object" && o.properties) {
    expect(o.additionalProperties, path).toBe(false);
    expect([...(o.required as string[])].sort(), path).toEqual(Object.keys(o.properties as object).sort());
  }
  for (const [k, v] of Object.entries(o)) check(v, `${path}.${k}`);
}

describe("codex structured-output schemas", () => {
  it.each([["scout", ScoutSchema], ["reader", ReaderSchema], ["cartographer", CartographerSchema]])("%s schema is strict", (_n, schema) => {
    check(strictJsonSchema(schema));
  });
});
