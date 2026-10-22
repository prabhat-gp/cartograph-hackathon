import { ArrowRight, ShieldCheck, Sparkles, Timer } from "lucide-react";
import { APP_URL, MAP_RUN, REPO_URL } from "@/lib/site";
import { GithubMark, Logo } from "./Logo";
import { MapPreview } from "./MapPreview";

const nav = [
  { href: "#why", label: "Why" },
  { href: "#how", label: "How it works" },
  { href: "#sponsors", label: "Sponsors" },
];

export function Header() {
  return (
    <header className="contours relative overflow-hidden bg-night-950 text-white">
      <nav className="sticky top-0 z-20 border-b border-white/8 bg-night-950/70 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href="#" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <Logo className="size-8" /> Cartograph
          </a>
          <div className="hidden items-center gap-8 text-sm text-white/65 md:flex">
            {nav.map((n) => (
              <a key={n.href} href={n.href} className="transition hover:text-white">
                {n.label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <a href={REPO_URL} target="_blank" rel="noreferrer" aria-label="Source on GitHub" className="hidden rounded-lg p-2 text-white/60 transition hover:bg-white/5 hover:text-white sm:block">
              <GithubMark className="size-5" />
            </a>
            <a href={APP_URL} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3.5 py-2 text-sm font-medium ring-1 ring-white/15 transition hover:bg-white/15">
              Open Cartograph <ArrowRight className="size-4" />
            </a>
          </div>
        </div>
      </nav>

      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-16 pb-20 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-24 lg:pb-28">
        <div className="rise">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80">
            <Sparkles className="size-3.5 text-warn" /> Built at Open Agent Hackathon 2026 · Track 02
          </span>
          <h1 className="mt-6 text-[2.6rem] leading-[1.04] font-semibold tracking-[-0.035em] sm:text-[3.4rem] xl:text-[3.9rem]">
            Map any codebase.
            <span className="block bg-gradient-to-r from-brand-300 via-brand-400 to-[#b9a6ff] bg-clip-text text-transparent">
              Know why every line exists.
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/70">
            Cartograph&apos;s agents read your repository and draw its architecture, with every arrow cited from a real
            line of code. Click any dependency to trace it back to the commit, pull request and issue that put it there.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={APP_URL} className="group flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-brand to-violet-brand px-5 py-3 font-medium shadow-lg shadow-violet-brand/30 transition hover:brightness-110">
              Map a repository <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </a>
            <a href="#how" className="rounded-xl px-5 py-3 font-medium text-white/80 ring-1 ring-white/15 transition hover:bg-white/5 hover:text-white">
              See how it works
            </a>
          </div>
          <p className="mt-6 max-w-xl text-xs leading-relaxed text-white/45">
            Measured on 22 October: {MAP_RUN.repo} ({MAP_RUN.files} files) mapped in {MAP_RUN.seconds} s on NVIDIA Nemotron,
            {" "}{MAP_RUN.components} components and {MAP_RUN.cited} dependencies, each cited from the code.
          </p>
          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/70">
            <li className="flex items-center gap-2"><ShieldCheck className="size-4 text-cited" /> No citation, no arrow</li>
            <li className="flex items-center gap-2"><Timer className="size-4 text-brand-300" /> About 3 minutes a map</li>
          </ul>
        </div>
        <div className="rise [animation-delay:150ms]">
          <MapPreview />
        </div>
      </div>
    </header>
  );
}
