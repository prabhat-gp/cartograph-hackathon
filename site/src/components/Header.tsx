import { ArrowRight } from "lucide-react";
import { APP_URL, MAP_RUN, REPO_URL } from "@/lib/site";
import { HeroMap } from "./HeroMap";
import { GithubMark, Mark } from "./Mark";

const nav = [
  { href: "#why", label: "Why" },
  { href: "#survey", label: "How it works" },
  { href: "#instruments", label: "Sponsors" },
];

export function Header() {
  return (
    <header className="grain relative">
      {/* Masthead */}
      <nav className="sticky top-0 z-30 border-b border-ink bg-paper/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6">
          <a href="#" className="flex items-center gap-2.5">
            <Mark className="size-7" />
            <span className="font-serif text-2xl leading-none tracking-tight">Cartograph</span>
          </a>
          <span className="hidden font-mono text-[10.5px] tracking-[0.2em] text-ink-soft uppercase xl:block">
            An atlas of your code · Sheet 02 · Open Agent Hackathon 2026
          </span>
          <div className="flex items-center gap-5">
            <div className="hidden items-center gap-5 text-sm md:flex">
              {nav.map((n) => (
                <a key={n.href} href={n.href} className="text-ink-soft underline-offset-4 transition hover:text-ink hover:underline">
                  {n.label}
                </a>
              ))}
            </div>
            <a href={REPO_URL} target="_blank" rel="noreferrer" aria-label="Source on GitHub" className="hidden text-ink-soft transition hover:text-ink sm:block">
              <GithubMark className="size-5" />
            </a>
            <a href={APP_URL} className="flex items-center gap-1.5 rounded-sm bg-ink px-3.5 py-2 text-sm font-medium text-paper transition hover:bg-vermilion">
              Open the atlas <ArrowRight className="size-4" />
            </a>
          </div>
        </div>
      </nav>

      <div className="mx-auto grid max-w-7xl gap-12 px-4 pt-14 pb-20 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:gap-14 lg:pt-20 lg:pb-24">
        <div className="settle flex flex-col justify-center">
          <p className="font-mono text-[11px] tracking-[0.22em] text-vermilion uppercase">Track 02 · The agent that can explain why</p>
          <h1 className="mt-6 font-serif text-[3.4rem] leading-[0.95] tracking-[-0.01em] sm:text-7xl xl:text-[5.6rem]">
            Map any codebase.
            <br />
            Know <em className="text-vermilion">why</em> every line exists.
          </h1>
          <p className="mt-7 max-w-lg text-lg leading-relaxed text-ink-soft">
            Point Cartograph at a repository. Its agents survey the code and draw the architecture, every road cited from
            a real line. Pick any road and they walk it back to the commit, pull request and issue that built it.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
            <a href={APP_URL} className="group flex items-center gap-2 rounded-sm bg-vermilion px-6 py-3.5 font-medium text-paper-light shadow-[4px_4px_0_0_var(--color-ink)] transition hover:translate-x-px hover:translate-y-px hover:shadow-[3px_3px_0_0_var(--color-ink)]">
              Survey a repository <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </a>
            <a href="#survey" className="font-medium underline decoration-rule decoration-2 underline-offset-[6px] transition hover:decoration-vermilion">
              How the survey works
            </a>
          </div>
          <dl className="mt-12 grid max-w-lg grid-cols-3 border-t border-ink pt-4 font-mono">
            <div>
              <dt className="text-[10px] tracking-[0.18em] text-ink-soft uppercase">Surveyed</dt>
              <dd className="mt-1 text-sm">{MAP_RUN.repo}</dd>
            </div>
            <div>
              <dt className="text-[10px] tracking-[0.18em] text-ink-soft uppercase">Elapsed</dt>
              <dd className="mt-1 text-sm">{MAP_RUN.seconds} s · {MAP_RUN.files} files</dd>
            </div>
            <div>
              <dt className="text-[10px] tracking-[0.18em] text-ink-soft uppercase">Roads drawn</dt>
              <dd className="mt-1 text-sm">{MAP_RUN.cited}, all cited</dd>
            </div>
          </dl>
          <p className="mt-3 font-mono text-[10.5px] text-ink-faint">Measured 22 Oct 2026 on NVIDIA Nemotron.</p>
        </div>
        <div className="settle [animation-delay:120ms]">
          <HeroMap />
        </div>
      </div>
    </header>
  );
}
