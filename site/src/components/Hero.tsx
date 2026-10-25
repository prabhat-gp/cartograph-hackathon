"use client";

import { ArrowDown, ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { APP_URL } from "@/lib/site";
import { HeroAtlas } from "./HeroAtlas";

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, type: "spring" as const, stiffness: 120, damping: 20 },
});

export function Hero() {
  return (
    <header id="top" className="grain relative overflow-hidden">
      <div className="survey-grid absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_70%_40%,black,transparent_75%)]" />
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 pt-32 pb-24 sm:px-6 lg:min-h-[92vh] lg:grid-cols-[1fr_1.05fr] lg:gap-14 lg:pt-28">
        <div>
          <motion.p {...rise(0.05)} className="inline-flex items-center gap-2 rounded-full border border-ink/20 bg-paper-light/70 px-3 py-1 font-mono text-[11px] tracking-[0.12em] text-ink-soft uppercase">
            <span className="size-1.5 animate-pulse rounded-full bg-vermilion" /> Open Agent Hackathon 2026
          </motion.p>
          <motion.h1 {...rise(0.15)} className="mt-6 font-serif text-[3.4rem] leading-[0.94] tracking-[-0.015em] text-balance sm:text-[4.6rem] xl:text-[5.4rem]">
            Reverse-engineer any codebase.
            <br />
            Know <em className="text-vermilion">why</em> every line exists.
          </motion.h1>
          <motion.div {...rise(0.3)} className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
            <motion.a
              href={APP_URL}
              whileHover={{ x: 1, y: 1, boxShadow: "2px 2px 0 0 var(--color-ink)" }}
              whileTap={{ x: 3, y: 3, boxShadow: "0px 0px 0 0 var(--color-ink)" }}
              initial={{ boxShadow: "3px 3px 0 0 var(--color-ink)" }}
              className="group flex items-center gap-2 rounded-[4px] border border-ink bg-vermilion px-7 py-4 text-lg font-medium text-paper-light"
            >
              Map it <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" />
            </motion.a>
            <a href="#product" className="group flex items-center gap-2 font-medium text-ink-soft transition-colors hover:text-ink">
              See it work <ArrowDown className="size-4 transition-transform group-hover:translate-y-0.5" />
            </a>
          </motion.div>
        </div>
        <motion.div className="min-w-0" initial={{ opacity: 0, y: 30, rotate: 1.5 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ delay: 0.25, type: "spring", stiffness: 70, damping: 16 }}>
          <HeroAtlas />
        </motion.div>
      </div>
    </header>
  );
}
