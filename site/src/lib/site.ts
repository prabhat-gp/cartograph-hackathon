// Everything the page states as fact lives here, next to where it was measured.

/** The Cartograph desk (the map app). Set NEXT_PUBLIC_APP_URL when it's deployed. */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:8787/app";

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
