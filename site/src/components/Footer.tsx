import { ArrowRight } from "lucide-react";
import { APP_URL, REPO_URL } from "@/lib/site";
import { GithubMark, Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="bg-paper">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-8 rounded-3xl bg-gradient-to-br from-blue-brand to-violet-brand p-8 text-white shadow-xl shadow-violet-brand/20 sm:p-12 md:flex-row md:items-center">
          <div>
            <h2 className="text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">Point Cartograph at your repo.</h2>
            <p className="mt-3 max-w-lg text-white/80">
              Get the map in minutes, then ask why any arrow exists. Every answer shows its sources.
            </p>
          </div>
          <a href={APP_URL} className="group flex shrink-0 items-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-ink transition hover:bg-white/90">
            Map a repository <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
          </a>
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-6 border-t border-black/5 pt-8 text-sm text-ink-soft md:flex-row md:items-center">
          <span className="flex items-center gap-2 font-medium text-ink">
            <Logo className="size-6" /> Cartograph · Open Agent Hackathon 2026
          </span>
          <span>Made with coffee, stubbornness and agents that cite their sources, by Prabhat.</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-ink">
            <GithubMark className="size-4" /> Source
          </a>
        </div>
      </div>
    </footer>
  );
}
