import { ArrowRight } from "lucide-react";
import { APP_URL, REPO_URL } from "@/lib/site";
import { GithubMark, Mark } from "./Mark";

export function Colophon() {
  return (
    <footer className="grain border-t border-ink">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:items-end">
          <h2 className="font-serif text-5xl leading-[1.02] sm:text-7xl">
            Every codebase has a history.
            <br />
            <em className="text-vermilion">Draw yours.</em>
          </h2>
          <div className="lg:justify-self-end">
            <a href={APP_URL} className="group inline-flex items-center gap-2 rounded-sm bg-vermilion px-7 py-4 text-lg font-medium text-paper-light shadow-[5px_5px_0_0_var(--color-ink)] transition hover:translate-x-px hover:translate-y-px hover:shadow-[4px_4px_0_0_var(--color-ink)]">
              Survey a repository <ArrowRight className="size-5 transition group-hover:translate-x-0.5" />
            </a>
            <p className="mt-4 max-w-xs text-sm text-ink-soft">A map in minutes, then the why behind any road. Every answer shows its sources.</p>
          </div>
        </div>

        <div className="mt-20 grid gap-8 border-t border-ink pt-8 text-sm md:grid-cols-3">
          <div className="flex items-start gap-3">
            <Mark className="size-8 shrink-0" />
            <p className="text-ink-soft">
              <span className="font-serif text-xl text-ink">Cartograph</span>
              <br />
              Open Agent Hackathon 2026 · Track 02
            </p>
          </div>
          <p className="text-ink-soft">
            <span className="font-mono text-[10.5px] tracking-[0.2em] text-ink uppercase">Colophon</span>
            <br />
            Set in Instrument Serif, Instrument Sans and IBM Plex Mono. Surveyed with NVIDIA Nemotron, Meterless and Zetaris.
          </p>
          <div className="text-ink-soft md:text-right">
            <p>Made with coffee, stubbornness and agents that cite their sources, by Prabhat.</p>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-ink underline decoration-rule underline-offset-4 hover:decoration-vermilion">
              <GithubMark className="size-4" /> Source &amp; build log
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
