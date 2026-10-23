"use client";

import { ArrowUpRight } from "lucide-react";
import { AnimatePresence, motion, useTransform } from "motion/react";
import { type ReactNode, useRef } from "react";
import { WhenSeen, usePinnedStep } from "./Pinned";

export interface ProofFrame {
  caption: string;
  view: () => ReactNode;
}

export interface ChapterProps {
  id: string;
  index: number;
  total: number;
  sponsor: string;
  accent: string;
  requirement: string;
  line: string;
  frames: ProofFrame[];
  links: { label: string; href: string }[];
}

/** One sponsor: the plate pins, and its proof frames play as you scroll through. */
export function Chapter(p: ChapterProps) {
  const ref = useRef<HTMLElement>(null);
  const { step, progress } = usePinnedStep(ref, p.frames.length);

  return (
    <section id={p.id} ref={ref} className="relative">
      <div className="hidden lg:block" style={{ height: `${p.frames.length * 80 + 20}vh` }}>
        <div className="sticky top-0 flex h-screen items-center">
          <div className="mx-auto grid w-full max-w-7xl grid-cols-[0.75fr_1.25fr] items-center gap-14 px-6">
            <Side {...p} step={step} progress={progress} />
            <ProofWindow frames={p.frames} step={step} accent={p.accent} />
          </div>
        </div>
      </div>

      <div className="px-4 py-20 sm:px-6 lg:hidden">
        <Side {...p} step={-1} />
        <div className="mt-8 space-y-6">
          {p.frames.map((f) => (
            <div key={f.caption}>
              <p className="mb-2 font-mono text-[11px] text-paper/60">{f.caption}</p>
              <WhenSeen className="aspect-[16/11] overflow-hidden rounded-[6px] border border-paper/20 bg-[#24211c]">{f.view()}</WhenSeen>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Side(p: ChapterProps & { step: number; progress?: ReturnType<typeof usePinnedStep>["progress"] }) {
  return (
    <div>
      <p className="font-mono text-[11px] tracking-[0.2em] text-paper/50 uppercase">
        {String(p.index + 1).padStart(2, "0")} / {String(p.total).padStart(2, "0")}
      </p>
      <h3 className="mt-4 font-serif text-[4.2rem] leading-[0.92] text-paper-light">{p.sponsor}</h3>
      <p className="mt-5 inline-flex rounded-full border px-3 py-1 font-mono text-[10.5px] tracking-[0.1em] uppercase" style={{ borderColor: p.accent, color: p.accent }}>
        {p.requirement}
      </p>
      <p className="mt-5 max-w-sm text-lg leading-snug text-paper/75">{p.line}</p>

      {p.step >= 0 && p.progress && (
        <div className="mt-9 max-w-sm">
          <div className="flex gap-1.5">
            {p.frames.map((f, i) => (
              <Segment key={f.caption} i={i} n={p.frames.length} progress={p.progress!} accent={p.accent} />
            ))}
          </div>
          <div className="relative mt-3 h-6 overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.p
                key={p.step}
                initial={{ y: 14, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -14, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="absolute font-mono text-[12px] text-paper/70"
              >
                {p.frames[p.step].caption}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
      )}

      <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2">
        {p.links.map((l) => (
          <li key={l.href}>
            <a href={l.href} target="_blank" rel="noreferrer" className="group inline-flex items-center gap-1 font-mono text-[11.5px] text-paper/55 transition-colors hover:text-paper-light">
              {l.label} <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Segment({ i, n, progress, accent }: { i: number; n: number; progress: ReturnType<typeof usePinnedStep>["progress"]; accent: string }) {
  const fill = useTransform(progress, [i / n, (i + 1) / n], ["0%", "100%"]);
  return (
    <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-paper/15">
      <motion.span className="block h-full rounded-full" style={{ width: fill, background: accent }} />
    </span>
  );
}

function ProofWindow({ frames, step, accent }: { frames: ProofFrame[]; step: number; accent: string }) {
  return (
    <div className="relative rounded-[8px] border border-paper/20 bg-[#24211c] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]">
      <div className="flex items-center gap-2 border-b border-paper/10 px-4 py-2.5">
        {frames.map((f, i) => (
          <motion.span key={f.caption} animate={{ width: i === step ? 22 : 8, background: i === step ? accent : "rgba(242,237,225,0.2)" }} className="h-2 rounded-full" />
        ))}
      </div>
      <div className="relative aspect-[16/10] overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, scale: 0.98, filter: "blur(6px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 1.01, filter: "blur(6px)" }}
            transition={{ duration: 0.35 }}
            className="absolute inset-0"
          >
            {frames[step].view()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
