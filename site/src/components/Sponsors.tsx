import { ArrowUpRight } from "lucide-react";
import { CODE, EXPRESS_EXPLAINED_PCT, MAP_RUN } from "@/lib/site";

const sponsors = [
  {
    name: "NVIDIA Nemotron",
    role: "The models behind every agent",
    color: "from-[#76b900]/25",
    mark: "N",
    markClass: "bg-[#76b900] text-black",
    stat: `${MAP_RUN.seconds} s`,
    statLabel: `to map ${MAP_RUN.repo}, ${MAP_RUN.readers} readers in parallel`,
    text: "Nemotron 3 Ultra plans and assembles the map; Nemotron 3.5 Lightning reads the code. Answers are validated against a schema and repaired, never trusted blind.",
    link: { label: "The model client", href: CODE("src/llm/client.ts") },
  },
  {
    name: "Meterless",
    role: "AI provider and memory",
    color: "from-[#ff7a45]/25",
    mark: "M",
    markClass: "bg-[#ff7a45] text-black",
    stat: "13 / 13",
    statLabel: "H-MEM conformance checks passed",
    text: "Nightshift is Cartograph's primary AI provider, with NVIDIA directly as the fallback. Our own H-MEM engine remembers verified findings with their sources and a trust ledger.",
    link: { label: "H-MEM in our code", href: CODE("src/memory/hmem.ts") },
  },
  {
    name: "Zetaris",
    role: "The data layer",
    color: "from-[#3aa0ff]/25",
    mark: "Z",
    markClass: "bg-[#3aa0ff] text-black",
    stat: `${EXPRESS_EXPLAINED_PCT}%`,
    statLabel: "of express's traced lines have a stated reason",
    text: "Git history, blame, pull requests, issues and reviews become one Unified Semantic Layer. Its data-quality rules measure how explainable a codebase is.",
    link: { label: "The provenance USL", href: CODE("sql/zetaris/provenance_usl.sql") },
  },
];

export function Sponsors() {
  return (
    <section id="sponsors" className="contours scroll-mt-16 bg-night-950 py-24 text-white sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-end">
          <div>
            <p className="font-mono text-xs font-medium tracking-[0.18em] text-brand-300 uppercase">Sponsors</p>
            <h2 className="mt-4 text-4xl leading-[1.08] font-semibold tracking-[-0.03em] sm:text-5xl">
              Three sponsors.
              <span className="block text-white/55">Three jobs in the product.</span>
            </h2>
          </div>
          <p className="text-lg leading-relaxed text-white/65">
            Not logos on a slide. Each one runs a part of Cartograph you can open in the code, and each claim below
            links to it.
          </p>
        </div>

        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {sponsors.map((s) => (
            <article key={s.name} className={`relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br ${s.color} to-night-900 p-7`}>
              <div className="flex items-center gap-3">
                <span className={`grid size-10 place-items-center rounded-xl text-lg font-bold ${s.markClass}`}>{s.mark}</span>
                <div>
                  <h3 className="font-semibold">{s.name}</h3>
                  <p className="text-sm text-white/55">{s.role}</p>
                </div>
              </div>
              <p className="mt-6 font-mono text-4xl font-semibold tracking-tight">{s.stat}</p>
              <p className="mt-1 text-sm text-white/55">{s.statLabel}</p>
              <p className="mt-5 text-[15px] leading-relaxed text-white/75">{s.text}</p>
              <a href={s.link.href} target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-white/8 px-3 py-2 text-sm font-medium ring-1 ring-white/12 transition hover:bg-white/15">
                {s.link.label} <ArrowUpRight className="size-4" />
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
