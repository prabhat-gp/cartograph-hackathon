import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { CODE, EXPRESS_EXPLAINED_PCT, HMEM_LEDGER, KY_EXPLAINED_PCT, MODEL_ROSTER, USAGE } from "@/lib/site";
import { PlateLabel } from "./Mark";

type Sheet = {
  symbol: string;
  color: string;
  sponsor: string;
  requirement: string;
  does: string;
  seen: string;
  evidenceTitle: string;
  evidence: ReactNode;
  reading: { value: string; unit: string };
  verify: { label: string; href: string }[];
};

const fmt = (n: number) => n.toLocaleString("en-US");

/** A real excerpt, set like a survey note: a caption, then the record itself. */
function Excerpt({ children }: { children: ReactNode }) {
  return <pre className="overflow-x-auto bg-ink p-5 font-mono text-[12.5px] leading-relaxed text-paper/90">{children}</pre>;
}
const k = (s: string) => <span className="text-ochre">{s}</span>;
const c = (s: string) => <span className="text-paper/45">{s}</span>;

const sheets: Sheet[] = [
  {
    symbol: "▲",
    color: "text-sea",
    sponsor: "Zetaris",
    requirement: "Build a Unified Semantic Layer, query it, add a data-quality rule",
    does: "Git history, blame, pull requests, issues and review comments are loaded into an evidence store that Zetaris reads as a JDBC source and models as the provenance USL: nine tables with keys, so one query walks from a line of code to the commit, pull request and issue behind it. Two data-quality rules score how explainable a codebase is.",
    seen: "Find out why on any arrow (the Investigator queries the USL live), and the Why-coverage overlay (the DQ rules).",
    evidenceTitle: "The Investigator's first query for a clicked arrow",
    evidence: (
      <>
        {k("SELECT")} lo.line_start, lo.commit_sha, c.subject, c.pr_id{"\n"}
        {k("FROM")} lightning.metastore.cartograph.provenance.line_origin lo{"\n"}
        {k("JOIN")} lightning.metastore.cartograph.provenance.code_change c{"\n"}
        {"  "}
        {k("ON")} c.sha = lo.commit_sha{"\n"}
        {k("WHERE")} lo.file_id = <span className="text-vermilion">&apos;sindresorhus/ky:source/core/constants.ts&apos;</span>{"\n"}
        {"  "}
        {k("AND")} lo.line_end &gt;= 263 {k("AND")} lo.line_start &lt;= 263{"\n\n"}
        {c("-- data-quality rules on the same layer")}
        {"\n"}
        has_review_trail | code_change  | pr_id IS NOT NULL{"\n"}
        states_a_reason  | pull_request | issue_count &gt; 0 OR length(body) &gt;= 120
      </>
    ),
    reading: { value: `${EXPRESS_EXPLAINED_PCT}%`, unit: `of traced express lines state a reason (ky: ${KY_EXPLAINED_PCT}% of arrows)` },
    verify: [
      { label: "USL definition", href: CODE("sql/zetaris/provenance_usl.sql") },
      { label: "DQ rules", href: CODE("sql/zetaris/dq_rules.sql") },
      { label: "Live queries", href: CODE("src/agent/evidence.ts") },
    ],
  },
  {
    symbol: "●",
    color: "text-vermilion",
    sponsor: "Meterless · Build",
    requirement: "A Meterless Engine inside a working feature",
    does: "The H-MEM engine is Cartograph's memory. Every answer the Critic approves is stored with its sources; the next question about the same code starts from it; findings about lines that have since changed are set aside; and the Helpful / Not helpful / Wrong buttons feed its trust ledger.",
    seen: "Under every Find out why answer: “Remembered · Meterless H-MEM”, with the feedback buttons.",
    evidenceTitle: "A real memory, written after the Critic approved an answer about ky",
    evidence: (
      <>
        {"{"}
        {"\n"}
        {"  "}
        {k('"content"')}: &quot;The `ky.retry()` function creates a `RetryMarker`{"\n"}
        {"              "}instance to signal forced retries.&quot;,{"\n"}
        {"  "}
        {k('"source"')}: &quot;cartograph:critic-approved&quot;,{"\n"}
        {"  "}
        {k('"confidence"')}: 0.85,{"\n"}
        {"  "}
        {k('"provenance"')}: {"{ "}
        {k('"refs"')}: [&quot;code:source/core/constants.ts:263-263&quot;] {"}"},{"\n"}
        {"  "}
        {k('"accessCount"')}: 2{"\n"}
        {"}"}
        {"\n\n"}
        {c("-- trust ledger, per repository")}
        {"\n"}
        {HMEM_LEDGER.map((r) => `${r.repo.padEnd(19)} ${String(r.created).padStart(2)} created · ${r.reads} reads · ${r.updates} updated\n`)}
      </>
    ),
    reading: { value: "13/13", unit: "Meterless H-MEM conformance checks pass" },
    verify: [
      { label: "H-MEM engine", href: CODE("src/memory/hmem.ts") },
      { label: "Used in the agents", href: CODE("src/memory/findings.ts") },
      { label: "Conformance suite", href: CODE("third_party/meterless-hmem-conformance") },
    ],
  },
  {
    symbol: "●",
    color: "text-vermilion",
    sponsor: "Meterless · Power",
    requirement: "Meterless Runtime as the primary AI provider",
    does: "With a Runtime token set, every agent call goes to Nightshift's OpenAI-compatible API under the Runtime 1.4 contract: bearer token, app and scope headers, meterless/fast and meterless/deep modes, health from GET /v1/models, connect links. NVIDIA is called directly only when the runtime can't be reached. Nightshift has no build for our hosting server or our Intel Mac, so this site calls NVIDIA directly, as the Meterless team advised.",
    seen: "The desk's Powered by panel shows the runtime's live state.",
    evidenceTitle: "Every agent call, when Nightshift is running",
    evidence: (
      <>
        {k("POST")} http://127.0.0.1:8088/v1/chat/completions{"\n"}
        Authorization: Bearer {c("<runtime token>")}
        {"\n"}
        meterless-app: cartograph{"\n"}
        meterless-scope: user{"\n\n"}
        {"{ "}
        {k('"model"')}: &quot;meterless/deep&quot;, {k('"response_format"')}: {"{ "}&quot;type&quot;: &quot;json_object&quot;{" }"}, …{" }"}
        {"\n\n"}
        {c("-- runtime offline → NVIDIA direct; runtime answered → its answer stands")}
      </>
    ),
    reading: { value: "1.4", unit: "Runtime contract implemented" },
    verify: [
      { label: "Runtime provider", href: CODE("src/meterless/runtime.ts") },
      { label: "Provider choice", href: CODE("src/config.ts") },
      { label: "Model client", href: CODE("src/llm/client.ts") },
    ],
  },
  {
    symbol: "◆",
    color: "text-forest",
    sponsor: "NVIDIA Nemotron",
    requirement: "Nemotron models in the agents",
    does: "Every agent runs on Nemotron: Ultra plans, merges and judges; Lightning reads files in parallel and writes answers. Strict JSON-schema output runs away on the free tier, so the client asks for JSON, validates it, salvages partial output and gives the model one repair turn. Every call is logged against daily caps.",
    seen: "Every map and every answer. The live survey view names each agent as it works.",
    evidenceTitle: `Agents, models and the usage ledger, ${USAGE.measured}`,
    evidence: (
      <>
        {MODEL_ROSTER.map((r) => (
          <span key={r.model}>
            {k(r.model.padEnd(31))} {c(r.tier.padEnd(5))} {r.agents}
            {"\n"}
          </span>
        ))}
        {"\n"}
        {c("-- calls and tokens, from .cartograph/usage.jsonl")}
        {"\n"}
        {USAGE.rows.map((r) => `${r.model.padEnd(31)} ${String(r.calls).padStart(3)} calls  ${fmt(r.tokens).padStart(9)} tokens\n`)}
      </>
    ),
    reading: { value: fmt(USAGE.rows.reduce((n, r) => n + r.calls, 0)), unit: `Nemotron calls logged, ${USAGE.measured}` },
    verify: [
      { label: "Model client", href: CODE("src/llm/client.ts") },
      { label: "Usage ledger", href: CODE("src/llm/usage.ts") },
      { label: "Agent prompts", href: CODE("src/agent/agents.ts") },
    ],
  },
];

export function PlateInstruments() {
  return (
    <section id="instruments" className="scroll-mt-14 border-t border-ink bg-paper-deep py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-end">
          <div>
            <PlateLabel plate="III" title="Sponsors" />
            <h2 className="mt-6 font-serif text-5xl leading-[1.02] sm:text-6xl">
              The instruments,
              <br />
              <em className="text-ink-soft">with the readings.</em>
            </h2>
          </div>
          <p className="max-w-lg text-lg leading-relaxed text-ink-soft lg:justify-self-end">
            For each sponsor: the requirement it meets, where you see it in Cartograph, and a real excerpt from our code or
            data. Every link opens the source.
          </p>
        </div>

        <div className="mt-14 grid gap-8">
          {sheets.map((s) => (
            <article key={s.sponsor} className="grid border border-ink bg-paper-light lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              <div className="flex flex-col gap-5 p-6 sm:p-8">
                <div>
                  <p className="flex items-center gap-3 text-2xl font-medium">
                    <span className={s.color}>{s.symbol}</span> {s.sponsor}
                  </p>
                  <p className="mt-2 font-mono text-[11px] tracking-[0.16em] text-vermilion uppercase">Requirement · {s.requirement}</p>
                </div>
                <p className="text-[15px] leading-relaxed text-ink-soft">{s.does}</p>
                <p className="border-l-2 border-vermilion pl-3 text-[14.5px] leading-relaxed">
                  <span className="font-medium">Where you see it: </span>
                  <span className="text-ink-soft">{s.seen}</span>
                </p>
                <div className="mt-auto flex flex-wrap items-end justify-between gap-5 border-t border-rule pt-5">
                  <p>
                    <span className="block font-serif text-5xl leading-none">{s.reading.value}</span>
                    <span className="mt-1 block max-w-[16rem] font-mono text-[11px] text-ink-soft">{s.reading.unit}</span>
                  </p>
                  <ul className="flex flex-col gap-1.5 text-right">
                    {s.verify.map((v) => (
                      <li key={v.href}>
                        <a href={v.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs underline decoration-rule underline-offset-4 hover:text-vermilion hover:decoration-vermilion">
                          {v.label} <ArrowUpRight className="size-3.5" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <figure className="flex min-w-0 flex-col border-t border-ink bg-ink lg:border-t-0 lg:border-l">
                <figcaption className="border-b border-paper/15 px-5 py-3 font-mono text-[10.5px] tracking-[0.18em] text-paper/60 uppercase">{s.evidenceTitle}</figcaption>
                <Excerpt>{s.evidence}</Excerpt>
              </figure>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
