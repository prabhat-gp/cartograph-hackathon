// End-to-end pipeline test with the offline fixture brain:
// map chai-commerce → verifier drops the planted hallucination → the drift
// commit is caught as a critical layering violation → the fix clears it.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const DEMO = path.resolve(__dirname, "../demo");
const SOURCE = path.resolve(__dirname, "../../chai-commerce");

const tmp = mkdtempSync(path.join(tmpdir(), "cartograph-test-"));
const repoDir = path.join(tmp, "chai-commerce");
process.env.CARTOGRAPH_DATA_DIR = path.join(tmp, "data");
process.env.CARTOGRAPH_BRAIN = "fixture";
process.env.CARTOGRAPH_FIXTURE_DELAY = "0";

const jobs = await import("../src/server/jobs");
const store = await import("../src/server/store");
const analysis = await import("../src/server/graph/analysis");

async function waitFor(job: { status: string }) {
  for (let i = 0; i < 200 && job.status === "running"; i++) await new Promise((r) => setTimeout(r, 25));
  expect(job.status).toBe("done");
}

function runDemo(script: string) {
  try {
    // No remote and no server: the script commits, then its local-hook curl fails.
    execFileSync(path.join(DEMO, script), [repoDir], { env: { ...process.env, CARTOGRAPH_URL: "http://127.0.0.1:9" }, stdio: "pipe" });
  } catch {
    /* expected */
  }
}

describe("cartograph pipeline (fixture brain)", () => {
  beforeAll(() => {
    execFileSync("git", ["clone", "-q", SOURCE, repoDir]);
  });

  it("maps the repo and drops edges it cannot cite", async () => {
    const job = jobs.startMapJob(repoDir);
    await waitFor(job);
    const graph = store.loadGraph(job.repoKey)!;
    expect(graph.nodes.length).toBe(17);
    expect(graph.stats.edgesDropped).toBe(1); // the planted orders-api → sendgrid hallucination
    expect(graph.edges.some((e) => e.from === "orders-api" && e.to === "sendgrid")).toBe(false);
    expect(graph.edges.length).toBe(26);
    // Line numbers were corrected from the placeholder `1` to the real lines.
    const rzp = graph.edges.find((e) => e.from === "order-service" && e.to === "razorpay")!;
    expect(rzp.evidence[0].line).toBeGreaterThan(30);
    expect(graph.flows.map((f) => f.id)).toEqual(["place-order", "payment-confirmation", "browse-catalog", "otp-login"]);
    expect(graph.flows[0].steps.length).toBe(6);
  });

  it("re-mapping the same commit is a cache hit", async () => {
    const job = jobs.startMapJob(repoDir);
    await waitFor(job);
    expect(job.cached).toBe(true);
  });

  it("computes blast radius", () => {
    const graph = store.loadGraph(store.findRepo("chai-commerce")!.repo.key)!;
    const b = analysis.blastRadius(graph, "redis")!;
    const impacted = b.impacted.map((i) => i.node.id);
    expect(impacted).toEqual(expect.arrayContaining(["products-api", "cart-api", "order-service", "auth-api", "storefront", "browser"]));
    expect(b.brokenFlows.map((f) => f.id)).toEqual(expect.arrayContaining(["place-order", "browse-catalog", "otp-login"]));
  });

  it("flags the live-stock commit as a critical layering violation", async () => {
    runDemo("drift-live-stock.sh");
    const key = store.findRepo("chai-commerce")!.repo.key;
    const job = jobs.startReviewJob(key, { source: "manual" })!;
    await waitFor(job);
    const [report] = store.listDrift(key);
    expect(report.maxSeverity).toBe("critical");
    expect(report.commits[0].message).toBe("feat(cart): show live stock on cart page");
    expect(report.added.edges.map((e) => `${e.from}->${e.to}`)).toEqual(["storefront->postgres"]);
    expect(report.findings[0].rule).toBe("layering.client-to-data");
    expect(report.added.edges[0].evidence[0]).toMatchObject({ path: "web/app/cart/stock.ts", line: 6 });
    // The rule's title, with the reviewer's specific explanation.
    expect(report.findings[0].title).toBe("Storefront now talks to Postgres directly");
    expect(report.findings[0].detail).toContain("Products API already returns");
    // Reviewer finding merged into the rule finding rather than duplicated.
    expect(report.findings.filter((f) => f.severity === "critical")).toHaveLength(1);
    const graph = store.loadGraph(key)!;
    expect(graph.mode).toBe("incremental");
    expect(graph.edges.some((e) => e.from === "storefront" && e.to === "postgres")).toBe(true);
  });

  it("the fix removes the direct dependency again", async () => {
    runDemo("fix-live-stock.sh");
    const key = store.findRepo("chai-commerce")!.repo.key;
    const job = jobs.startReviewJob(key, { source: "manual" })!;
    await waitFor(job);
    const [report] = store.listDrift(key);
    expect(report.removed.edges.map((e) => `${e.from}->${e.to}`)).toEqual(["storefront->postgres"]);
    expect(report.maxSeverity).toBe("none");
    expect(store.loadGraph(key)!.edges.some((e) => e.from === "storefront" && e.to === "postgres")).toBe(false);
  });
});
