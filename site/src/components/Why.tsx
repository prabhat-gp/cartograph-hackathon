import { ArrowUpRight, GitPullRequestArrow, Siren, UserRoundPlus } from "lucide-react";
import { COMPREHENSION, EXPRESS_EXPLAINED_PCT } from "@/lib/site";

const costs = [
  {
    icon: UserRoundPlus,
    title: "Onboarding",
    text: "A new engineer finds a strange retry, a cache, a direct database call. Nobody remembers why, so it either stays forever or gets “fixed” and breaks something.",
  },
  {
    icon: GitPullRequestArrow,
    title: "Drift",
    text: "A small push lets the storefront query the database directly. The diff looks harmless; the architecture just changed. Reviews catch lines, not layering.",
  },
  {
    icon: Siren,
    title: "Incidents",
    text: "Redis is down. What depends on it, and which of those paths were deliberate? At 2 a.m. the answer lives in a PR thread from three years ago.",
  },
];

export function Why() {
  return (
    <section id="why" className="scroll-mt-16 bg-paper py-24 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-end">
          <div>
            <p className="font-mono text-xs font-medium tracking-[0.18em] text-brand-600 uppercase">Why</p>
            <h2 className="mt-4 text-4xl leading-[1.08] font-semibold tracking-[-0.03em] sm:text-5xl">
              Code tells you what.
              <span className="block text-ink-soft">Almost nothing tells you why.</span>
            </h2>
          </div>
          <p className="text-lg leading-relaxed text-ink-soft">
            The reasons behind a codebase live in commit messages, pull requests, review threads and issues, scattered
            across years. Engineers rebuild that context by hand, every time.
          </p>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-2">
          <figure className="rounded-2xl border border-black/5 bg-white p-7 shadow-sm">
            <p className="text-6xl font-semibold tracking-tight text-ink">{COMPREHENSION.pct}%</p>
            <figcaption className="mt-3 text-[15px] leading-relaxed text-ink-soft">
              of a professional developer&apos;s time goes to understanding existing code, in a field study of 78
              engineers.{" "}
              <a href={COMPREHENSION.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-brand-600 hover:underline">
                {COMPREHENSION.source} <ArrowUpRight className="size-3.5" />
              </a>
            </figcaption>
          </figure>
          <figure className="rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50 to-white p-7 shadow-sm">
            <p className="text-6xl font-semibold tracking-tight text-brand-700">{EXPRESS_EXPLAINED_PCT}%</p>
            <figcaption className="mt-3 text-[15px] leading-relaxed text-ink-soft">
              of the lines we traced in <span className="font-mono text-[13px] text-ink">expressjs/express</span> lead to a
              pull request that states its reason. The rest have no pull request, or one that never says why. Measured with Cartograph on 22 October.
            </figcaption>
          </figure>
        </div>

        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {costs.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
              <span className="grid size-10 place-items-center rounded-xl bg-night-900 text-brand-300">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-5 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
