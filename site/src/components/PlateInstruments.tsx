import { ArrowUpRight } from "lucide-react";
import { CODE, EXPRESS_EXPLAINED_PCT, MAP_RUN } from "@/lib/site";
import { PlateLabel } from "./Mark";

const instruments = [
  {
    symbol: "◆",
    color: "text-forest",
    name: "NVIDIA Nemotron",
    job: "The models behind every agent. Nemotron 3 Ultra plans and assembles the map; Nemotron 3.5 Lightning reads the code in parallel.",
    reading: `${MAP_RUN.seconds} s`,
    unit: `to map ${MAP_RUN.repo}`,
    link: { label: "Model client", href: CODE("src/llm/client.ts") },
  },
  {
    symbol: "●",
    color: "text-vermilion",
    name: "Meterless",
    job: "Nightshift is the primary AI provider, with NVIDIA directly as fallback. Our H-MEM engine is the memory: findings with sources and a trust ledger.",
    reading: "13/13",
    unit: "H-MEM conformance checks",
    link: { label: "H-MEM engine", href: CODE("src/memory/hmem.ts") },
  },
  {
    symbol: "▲",
    color: "text-sea",
    name: "Zetaris",
    job: "The data layer. Git history, blame, pull requests, issues and reviews become one Unified Semantic Layer, with data-quality rules on explainability.",
    reading: `${EXPRESS_EXPLAINED_PCT}%`,
    unit: "of express lines with a stated reason",
    link: { label: "Provenance USL", href: CODE("sql/zetaris/provenance_usl.sql") },
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
              The instruments
              <br />
              <em className="text-ink-soft">we survey with.</em>
            </h2>
          </div>
          <p className="max-w-lg text-lg leading-relaxed text-ink-soft lg:justify-self-end">
            Each sponsor runs a real part of Cartograph. Every reading below was measured, and every row opens the code that
            produced it.
          </p>
        </div>

        <div className="mt-14 border border-ink bg-paper-light">
          <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,2.2fr)_minmax(0,1fr)_auto] border-b border-ink px-6 py-3 font-mono text-[10.5px] tracking-[0.2em] text-ink-soft uppercase md:grid">
            <span>Instrument</span>
            <span>What it does in Cartograph</span>
            <span>Reading</span>
            <span className="w-28 text-right">Inspect</span>
          </div>
          {instruments.map((x) => (
            <div key={x.name} className="grid gap-4 border-b border-rule px-6 py-7 last:border-b-0 md:grid-cols-[minmax(0,1.1fr)_minmax(0,2.2fr)_minmax(0,1fr)_auto] md:items-center md:gap-8">
              <p className="flex items-center gap-3 text-xl font-medium">
                <span className={`${x.color} text-2xl`}>{x.symbol}</span> {x.name}
              </p>
              <p className="text-[15px] leading-relaxed text-ink-soft">{x.job}</p>
              <p>
                <span className="block font-serif text-5xl leading-none">{x.reading}</span>
                <span className="mt-1 block font-mono text-[11px] text-ink-soft">{x.unit}</span>
              </p>
              <a href={x.link.href} target="_blank" rel="noreferrer" className="flex w-28 items-center justify-end gap-1 font-mono text-xs underline decoration-rule underline-offset-4 hover:text-vermilion hover:decoration-vermilion">
                {x.link.label} <ArrowUpRight className="size-3.5" />
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
