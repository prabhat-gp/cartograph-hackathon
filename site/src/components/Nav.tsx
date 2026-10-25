"use client";

import { ArrowRight } from "lucide-react";
import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { APP_URL, REPO_URL } from "@/lib/site";
import { GithubMark, Mark } from "./Mark";

const links = [
  { href: "#product", label: "Product" },
  { href: "#proof", label: "Sponsors" },
];

/** Steps out of the way while you read down the page and comes back the moment you scroll up. */
export function Nav() {
  const { scrollY } = useScroll();
  const [hidden, setHidden] = useState(false);
  const [raised, setRaised] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => {
    const prev = scrollY.getPrevious() ?? 0;
    setHidden(y > 240 && y > prev);
    setRaised(y > 8);
  });

  return (
    <motion.nav
      animate={{ y: hidden ? -72 : 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 36 }}
      className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300 ${raised ? "border-ink/80 bg-paper/85 backdrop-blur-md" : "border-transparent bg-transparent"}`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6">
        <a href="#top" className="group flex items-center gap-2.5" aria-label="Cartograph, back to top">
          <motion.span whileHover={{ rotate: 90 }} transition={{ type: "spring", stiffness: 260, damping: 14 }} className="block">
            <Mark className="size-8" />
          </motion.span>
          <span className="font-serif text-[26px] leading-none tracking-tight">Cartograph</span>
        </a>
        <div className="flex items-center gap-6">
          <div className="hidden items-center gap-6 text-[15px] md:flex">
            {links.map((l) => (
              <a key={l.href} href={l.href} className="group relative text-ink-soft transition-colors hover:text-ink">
                {l.label}
                <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-vermilion transition-transform duration-300 group-hover:scale-x-100" />
              </a>
            ))}
          </div>
          <a href={REPO_URL} target="_blank" rel="noreferrer" aria-label="Source on GitHub" className="hidden text-ink-soft transition hover:-translate-y-px hover:text-ink sm:block">
            <GithubMark className="size-5" />
          </a>
          <motion.a
            href={APP_URL}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            className="group flex items-center gap-1.5 rounded-[4px] border border-ink bg-vermilion px-4 py-2 text-sm font-medium text-paper-light shadow-[3px_3px_0_0_var(--color-ink)] transition-colors hover:bg-vermilion-deep"
          >
            Open the desk <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </motion.a>
        </div>
      </div>
    </motion.nav>
  );
}
