// Everything the page states as fact lives here, next to where it was measured.

/** The map desk, served by the same Cartograph server as this page. */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "/app";

export const REPO_URL = "https://github.com/prabhat-gp/cartograph-hackathon";
export const CODE = (path: string) => `${REPO_URL}/tree/qa/${path}`;

/** Measured on 22 Oct 2026: a fresh map of the chai-commerce test repo on NVIDIA Nemotron. */
export const MAP_RUN = {
  repo: "chai-commerce",
  files: 40,
  seconds: 167,
  components: 14,
  cited: 20,
  flows: 6,
  readers: 5,
};

/** A real answer from the explain agents on expressjs/express, 22 Oct 2026. */
export const WHY_RUN = {
  repo: "expressjs/express",
  question: "Why does res.redirect build its HTML body this way?",
  answer:
    "Some browsers show the redirect response instead of following it, and RFC 9110 makes following optional, so the body became a valid HTML page with a DOCTYPE and a title.",
  chain: [
    { kind: "Code", ref: "lib/response.js:849", url: "https://github.com/expressjs/express/blob/master/lib/response.js#L849" },
    { kind: "Commit", ref: "9a3f7ff", url: "https://github.com/expressjs/express/commit/9a3f7ff412" },
    { kind: "Pull request", ref: "#5167", url: "https://github.com/expressjs/express/pull/5167" },
    { kind: "Issue", ref: "#5058", url: "https://github.com/expressjs/express/issues/5058" },
  ],
  seconds: 18.5,
};

/** Zetaris data-quality rule has_review_trail over expressjs/express, 22 Oct 2026. */
export const EXPRESS_EXPLAINED_PCT = 19;

/** Xia et al., "Measuring Program Comprehension", IEEE Transactions on Software Engineering, 2018. */
export const COMPREHENSION = {
  pct: 58,
  source: "Xia et al., IEEE TSE 2018",
  url: "https://doi.org/10.1109/TSE.2017.2734091",
};

/** Which agents run on which Nemotron model (src/config.ts, src/agent/agents.ts, src/server/brain/run.ts). */
export const MODEL_ROSTER = [
  { model: "nemotron-3-ultra-550b-a55b", tier: "deep", agents: "Scout, Cartographer, Reviewer, Critic" },
  { model: "nemotron-3.5-lightning-30b-a3b", tier: "fast", agents: "Readers, Tracer, Planner, Writer" },
];

/** From the usage ledger (.cartograph/usage.jsonl, `npm run usage`), 22–23 Oct 2026. */
export const USAGE = {
  measured: "22–23 Oct 2026",
  rows: [
    { model: "nemotron-3.5-lightning-30b-a3b", calls: 64, tokens: 958_009 },
    { model: "nemotron-3-ultra-550b-a55b", calls: 56, tokens: 284_179 },
  ],
};

/** H-MEM ledger counts per repository (.cartograph/memory/<repo>/ledger.jsonl), 23 Oct 2026. */
export const HMEM_LEDGER = [
  { repo: "sindresorhus/ky", created: 15, reads: 54, updates: 1 },
  { repo: "expressjs/express", created: 11, reads: 30, updates: 2 },
];

/** Share of ky's map arrows whose cited line traces to a pull request that states a reason (Why-coverage, 22 Oct). */
export const KY_EXPLAINED_PCT = 13;
