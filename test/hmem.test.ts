import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HMEM } from "../src/memory/hmem";
import { recall, remember } from "../src/memory/findings";
import type { Draft, EvidenceItem } from "../src/agent/agents";

describe("H-MEM persistence", () => {
  it("reloads memories and the append-only ledger from disk", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hmem-"));
    const a = new HMEM({ persistDir: dir });
    const m = a.add({ content: "Retries are capped at 3 because of API rate limits (#4)", source: "test" });
    a.feedback(m.id, "helpful");
    const b = new HMEM({ persistDir: dir });
    expect(b.store.get(m.id)?.confidence).toBeCloseTo(0.75);
    expect(b.ledger.history(m.id).map((e) => e.action)).toEqual(["create", "feedback"]);
  });
});

describe("findings memory", () => {
  const evidence: EvidenceItem[] = [
    { id: "E1", kind: "commit", ref: "cccccccccc", title: "Limit retries", text: "", url: "u/c" },
    { id: "E2", kind: "pull_request", ref: "#5", title: "Limit retries", text: "", url: "u/pr5" },
  ];
  const draft: Draft = { answer: "a", claims: [{ text: "Retries in src/a.ts were capped in #5 after rate limiting", evidence: ["E1", "E2"] }], chain: [], confidence: "high", unknowns: [] };

  it("sets aside a finding whose commits no longer own the lines", () => {
    process.env.CARTOGRAPH_MEMORY_DIR = mkdtempSync(path.join(tmpdir(), "mem-"));
    const [saved] = remember({ repo: "o/stale", question: "why capped", file: "src/a.ts", draft, evidence, runId: "r1", supersede: [] });
    expect(saved.provenance.refs).toEqual(["u/c", "u/pr5"]);
    expect(saved.layer).toBe("long_term");
    expect(recall("o/stale", "why are retries capped in src/a.ts", "src/a.ts", ["c".repeat(40)]).stale).toHaveLength(0);
    const later = recall("o/stale", "why are retries capped in src/a.ts", "src/a.ts", ["d".repeat(40)]);
    expect(later.stale.map((m) => m.id)).toEqual([saved.id]);
    const [replacement] = remember({ repo: "o/stale", question: "why capped", file: "src/a.ts", draft, evidence, runId: "r2", supersede: later.stale });
    expect(replacement.supersedes).toBe(saved.id);
  });
});
