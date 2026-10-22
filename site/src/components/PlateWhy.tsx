import { ArrowUpRight } from "lucide-react";
import { COMPREHENSION, EXPRESS_EXPLAINED_PCT } from "@/lib/site";
import { PlateLabel } from "./Mark";

const notes = [
  {
    title: "The new engineer",
    text: "finds a strange retry, a cache, a direct database call. Nobody remembers why, so it stays forever or gets “fixed” and breaks something.",
  },
  {
    title: "The quiet push",
    text: "lets the storefront query the database directly. The diff looks harmless; the architecture just changed, and review only read the lines.",
  },
  {
    title: "The 2 a.m. page",
    text: "says Redis is down. What depends on it, and which of those paths were deliberate? The answer is in a pull request thread from three years ago.",
  },
];

function Measure({ value, children, tone }: { value: number; children: React.ReactNode; tone: "ink" | "vermilion" }) {
  return (
    <figure>
      <p className={`font-serif text-[6.5rem] leading-none tracking-tight ${tone === "vermilion" ? "text-vermilion" : "text-ink"}`}>
        {value}
        <span className="text-[3.5rem]">%</span>
      </p>
      {/* A scale bar filled to the measured share */}
      <div className="mt-4 flex h-2.5 border border-ink">
        <span className={tone === "vermilion" ? "bg-vermilion" : "bg-ink"} style={{ width: `${value}%` }} />
      </div>
      <figcaption className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-soft">{children}</figcaption>
    </figure>
  );
}

export function PlateWhy() {
  return (
    <section id="why" className="scroll-mt-14 border-t border-ink bg-paper-light py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <PlateLabel plate="I" title="Why" />
        <h2 className="mt-6 max-w-4xl font-serif text-5xl leading-[1.02] sm:text-6xl lg:text-7xl">
          Code records what it does. <em className="text-ink-soft">Almost nothing records why.</em>
        </h2>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft">
          The reasons live in commit messages, pull requests, review threads and issues, scattered across years.
          Engineers rebuild that context by hand, every single time.
        </p>

        <div className="mt-16 grid gap-14 md:grid-cols-2">
          <Measure value={COMPREHENSION.pct} tone="ink">
            of a professional developer&apos;s working time goes to understanding existing code, in a field study of 78
            engineers.{" "}
            <a href={COMPREHENSION.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-ink underline decoration-rule underline-offset-4 hover:decoration-vermilion">
              {COMPREHENSION.source} <ArrowUpRight className="size-3.5" />
            </a>
          </Measure>
          <Measure value={EXPRESS_EXPLAINED_PCT} tone="vermilion">
            of the lines we traced in <span className="font-mono text-[13.5px] text-ink">expressjs/express</span> lead to a
            pull request that states its reason. The rest have no pull request, or one that never says why. Measured with
            Cartograph, 22 Oct.
          </Measure>
        </div>

        <div className="mt-20 border-t border-ink">
          <p className="mt-6 font-mono text-[11px] tracking-[0.22em] text-ink-soft uppercase">Field notes · where it hurts</p>
          <ol className="mt-4 grid md:grid-cols-3">
            {notes.map((n, i) => (
              <li key={n.title} className="border-rule py-6 md:border-l md:px-7 md:first:border-l-0 md:first:pl-0">
                <span className="font-mono text-xs text-vermilion">{String(i + 1).padStart(2, "0")}</span>
                <p className="mt-2 text-[16px] leading-relaxed text-ink-soft">
                  <em className="font-serif text-2xl text-ink">{n.title}</em> {n.text}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
