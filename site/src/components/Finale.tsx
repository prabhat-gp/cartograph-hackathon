"use client";

import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { type FormEvent, useState } from "react";
import { APP_URL, AUTHOR_URL, REPO_URL } from "@/lib/site";
import { GithubMark, Mark } from "./Mark";

/** The last screen: type a repo, land in the desk with it ready to map. */
export function Finale() {
  const [repo, setRepo] = useState("");
  const go = (e: FormEvent) => {
    e.preventDefault();
    const name = repo.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
    location.href = name ? `${APP_URL}?map=${encodeURIComponent(name)}` : APP_URL;
  };

  return (
    <section className="grain relative overflow-hidden border-t border-ink bg-paper">
      {/* A survey route walking across the plate */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-60" viewBox="0 0 1200 500" preserveAspectRatio="none" aria-hidden="true">
        <path d="M-20 420 C 200 300, 360 460, 560 330 S 900 120, 1220 220" fill="none" stroke="var(--color-vermilion)" strokeWidth="2" className="route" />
        <path d="M-20 120 C 240 200, 420 60, 640 150 S 980 360, 1220 300" fill="none" stroke="var(--color-ink)" strokeOpacity="0.15" strokeWidth="1.5" strokeDasharray="4 8" />
      </svg>
      <div className="relative mx-auto max-w-4xl px-4 py-36 text-center sm:px-6">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ type: "spring", stiffness: 90, damping: 18 }}
          className="font-serif text-[3.8rem] leading-[0.95] sm:text-[5.6rem]"
        >
          Draw your <em className="text-vermilion">codebase.</em>
        </motion.h2>
        <motion.form
          onSubmit={go}
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.15, type: "spring", stiffness: 90, damping: 18 }}
          className="group mx-auto mt-12 flex max-w-xl items-center gap-2 rounded-[6px] border border-ink bg-paper-light p-2 pl-5 shadow-[6px_6px_0_0_var(--color-ink)] transition-shadow focus-within:shadow-[6px_6px_0_0_var(--color-vermilion)]"
        >
          <GithubMark className="size-5 shrink-0 text-ink-soft" />
          <label htmlFor="finale-repo" className="sr-only">
            GitHub repository
          </label>
          <input
            id="finale-repo"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repo"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-2.5 font-mono text-[15px] outline-none placeholder:text-ink-faint"
          />
          <motion.button
            type="submit"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            className="flex items-center gap-1.5 rounded-[4px] bg-vermilion px-5 py-3 font-medium text-paper-light"
          >
            Map it <ArrowRight className="size-4" />
          </motion.button>
        </motion.form>
        <p className="mt-5 font-mono text-[11.5px] text-ink-soft">Any public GitHub repository · a map in about three minutes</p>
      </div>

      <footer className="relative border-t border-ink">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6 px-4 py-8 text-sm sm:px-6">
          <div className="group flex items-center gap-3">
            <span className="transition-transform duration-500 group-hover:rotate-180">
              <Mark className="size-8" />
            </span>
            <span className="text-ink-soft">
              <span className="font-serif text-xl text-ink">Cartograph</span> · Open Agent Hackathon 2026 · Track 02
            </span>
          </div>
          <div className="flex items-center gap-6 text-ink-soft">
            <a href={APP_URL} className="transition-colors hover:text-ink">
              Open the desk
            </a>
            <a href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer" className="transition-colors hover:text-ink">
              README
            </a>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 transition-colors hover:text-ink">
              <GithubMark className="size-4" /> Source
            </a>
            <span>
              Made with chai, stubbornness and agents that cite their sources, by{" "}
              <a href={AUTHOR_URL} target="_blank" rel="noreferrer" className="font-medium text-ink underline decoration-vermilion decoration-2 underline-offset-4 transition-colors hover:text-vermilion">
                Prabhat
              </a>
            </span>
          </div>
        </div>
      </footer>
    </section>
  );
}
