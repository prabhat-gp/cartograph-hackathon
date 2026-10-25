import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.CARTOGRAPH_LOG_DIR = mkdtempSync(path.join(tmpdir(), "cartograph-sample-logs-"));
const { OUTPUT_DIR, listExamples, replayExample } = await import("../src/agent/sample");

describe("sample mode", () => {
  const examples = listExamples();

  it("ships at least three examples", () => {
    expect(examples.length).toBeGreaterThanOrEqual(3);
  });

  it.each(examples.map((e) => e.id))("%s replays the live answer with no keys", async (id) => {
    const recorded = JSON.parse(readFileSync(path.join(OUTPUT_DIR, `${id}.json`), "utf8"));
    const result = await replayExample(id);
    expect(result.status).toBe("success");
    expect(result.output!.answer).toBe(recorded.output.answer);
    expect(result.output!.approved).toBe(recorded.output.approved);
    // Same evidence behind the same claims, not just the same words.
    const cited = (o: { chain: { ref: string }[]; claims: { evidence: string[] }[] }) => ({ chain: o.chain.map((e) => e.ref), claims: o.claims.map((c) => c.evidence) });
    expect(cited(result.output!)).toEqual(cited(recorded.output));
    expect(result.agents.map((a) => a.name)).toEqual(["Planner", "Investigator", "Writer", "Critic", "Memory"]);
  });
});
