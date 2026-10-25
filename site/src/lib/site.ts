// Everything the page states as fact lives here, next to where it was measured.

/** The map desk, served by the same Cartograph server as this page. */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "/app";

export const REPO_URL = "https://github.com/prabhat-gp/cartograph-hackathon";
/** A file or folder on main: files open as /blob/, folders as /tree/. */
export const CODE = (path: string) => `${REPO_URL}/${/\.[a-z]+$/.test(path) ? "blob" : "tree"}/main/${path}`;
export const AUTHOR_URL = "https://prabhatgp.me";

/**
 * The hero loop: real PrepPilot code, the arrows Cartograph drew from it, and the
 * explain agents' approved answer for llm.py:26 (output_examples/01-gemini-provider.json).
 */
export const HERO_RUN = {
  repo: "siddarth-ba-72/Interview-Prep-Pilot-AI",
  file: "ai-service/app/llm.py",
  firstLine: 23,
  code: [
    "def get_client() -> AsyncOpenAI:",
    "    global _client",
    "    if _client is None:",
    '        if settings.llm_provider == "gemini":',
    "            _client = AsyncOpenAI(",
    '                api_key=_required(settings.gemini_api_key, ...),',
    "                base_url=settings.gemini_base_url,",
    "                timeout=settings.llm_timeout_seconds,",
    "            )",
    "        else:",
    "            _client = AsyncOpenAI(",
    '                api_key=_required(settings.openai_api_key, ...),',
    "                timeout=settings.llm_timeout_seconds,",
    "            )",
    "    return _client",
  ],
  /** Lines the Readers cited, and the part each call points to. */
  hits: [
    { line: 26, to: "Gemini" },
    { line: 34, to: "OpenAI" },
  ],
  chain: [
    { kind: "Code", ref: "llm.py:26", title: 'if settings.llm_provider == "gemini":' },
    { kind: "Commit", ref: "02d4c5a", title: "Add support for Gemini LLM provider and update configuration handling" },
    { kind: "Pull request", ref: "#6", title: "LLM Config" },
  ],
  answer: "Gemini was added to expand the model options, behind one config switch: settings.llm_provider.",
  seconds: 11.7,
};

/** Share of blamed express lines whose pull request states a reason (the states_a_reason condition), 22 Oct 2026. */
export const EXPRESS_EXPLAINED_PCT = 19;

/** Xia et al., "Measuring Program Comprehension", IEEE Transactions on Software Engineering, 2018. */
export const COMPREHENSION = {
  pct: 58,
  source: "Xia et al., IEEE TSE 2018",
  url: "https://doi.org/10.1109/TSE.2017.2734091",
};

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
