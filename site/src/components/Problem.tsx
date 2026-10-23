"use client";

import { animate, motion, useInView, useMotionValue, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef } from "react";
import { COMPREHENSION } from "@/lib/site";

// The pain in one picture: a line of code, and the four places its reason
// actually lives drifting apart as you scroll. All four are real (ky #779).
const scraps = [
  { kind: "Commit", ref: "68a5228", text: "Add ky.retry() to force retries from afterResponse hooks", dx: -235, dy: -150, r: -7 },
  { kind: "Pull request", ref: "#779", text: "Add ky.retry() to force retries", dx: 245, dy: -135, r: 6 },
  { kind: "Issue", ref: "#778", text: "Simplify forcing a retry in afterResponse hook?", dx: -250, dy: 150, r: 5 },
  { kind: "Discussion", ref: "#778", text: "4 comments: sholladay, sindresorhus, MrSquaare", dx: 235, dy: 160, r: -5 },
];

function Count({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px" });
  const n = useMotionValue(0);
  const shown = useTransform(n, (v) => Math.round(v));
  useEffect(() => {
    if (inView) animate(n, to, { duration: 1.6, ease: [0.16, 1, 0.3, 1] });
  }, [inView, n, to]);
  return <motion.span ref={ref}>{shown}</motion.span>;
}

export function Problem() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const spread = useTransform(scrollYProgress, [0.15, 0.55], [reduce ? 1 : 0, 1]);

  return (
    <section ref={ref} className="relative overflow-hidden border-t border-ink bg-paper-light py-28 sm:py-36">
      <div className="mx-auto grid max-w-7xl items-center gap-16 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="min-w-0">
          <p className="font-serif text-[9rem] leading-[0.8] tracking-tight text-ink sm:text-[12rem]">
            <Count to={COMPREHENSION.pct} />
            <span className="text-[0.45em] text-vermilion">%</span>
          </p>
          <p className="mt-6 max-w-sm font-serif text-3xl leading-tight">of a developer&apos;s day goes to understanding code.</p>
          <a href={COMPREHENSION.url} target="_blank" rel="noreferrer" className="mt-4 inline-block font-mono text-[11px] text-ink-faint underline decoration-rule underline-offset-4 transition-colors hover:text-ink">
            {COMPREHENSION.source}
          </a>
        </div>

        <div className="relative grid h-[460px] min-w-0 place-items-center max-sm:h-[340px] max-sm:scale-[0.6]">
          {scraps.map((s, i) => (
            <Scrap key={s.kind} scrap={s} spread={spread} index={i} />
          ))}
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ type: "spring", stiffness: 140, damping: 18 }}
            className="relative z-10 w-[min(500px,94%)] rounded-[5px] border border-ink bg-ink p-4 font-mono text-[12.5px] text-paper shadow-[6px_6px_0_0_var(--color-vermilion)]"
          >
            <p className="mb-3 text-[10.5px] tracking-[0.14em] text-paper/50 uppercase">source/core/constants.ts</p>
            <div className="space-y-1.5 opacity-30">
              <span className="block h-2 w-3/5 rounded bg-paper/40" />
              <span className="block h-2 w-2/5 rounded bg-paper/40" />
            </div>
            <p className="my-2 -mx-1 overflow-hidden rounded bg-paper/10 px-1 py-1 leading-relaxed whitespace-nowrap">
              <span className="mr-3 text-paper/40">263</span>
              <span className="text-ochre">export const</span> retry = (options) =&gt; <span className="text-ochre">new</span> RetryMarker(options);
            </p>
            <div className="space-y-1.5 opacity-30">
              <span className="block h-2 w-1/2 rounded bg-paper/40" />
              <span className="block h-2 w-2/3 rounded bg-paper/40" />
            </div>
            <motion.span
              initial={{ scale: 0, rotate: -20 }}
              whileInView={{ scale: 1, rotate: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.5, type: "spring", stiffness: 300, damping: 12 }}
              className="absolute -top-4 -right-4 grid size-11 place-items-center rounded-full bg-vermilion font-serif text-3xl text-paper-light italic"
            >
              ?
            </motion.span>
          </motion.div>
        </div>
      </div>
      <p className="mx-auto mt-16 max-w-7xl px-4 text-center font-serif text-2xl text-ink-soft italic sm:px-6">
        The reason exists. It&apos;s just scattered.
      </p>
    </section>
  );
}

function Scrap({ scrap, spread, index }: { scrap: (typeof scraps)[number]; spread: ReturnType<typeof useTransform<number, number>>; index: number }) {
  const x = useTransform(spread, [0, 1], [0, scrap.dx]);
  const y = useTransform(spread, [0, 1], [0, scrap.dy]);
  const rotate = useTransform(spread, [0, 1], [0, scrap.r]);
  const opacity = useTransform(spread, [0, 0.25], [0, 1]);
  return (
    <motion.div
      style={{ x, y, rotate, opacity, zIndex: index }}
      whileHover={{ scale: 1.05, rotate: 0, zIndex: 20 }}
      className="absolute w-[220px] cursor-default rounded-[4px] border border-ink/70 bg-paper p-3 shadow-[3px_3px_0_0_var(--color-ink)]"
    >
      <p className="flex items-center justify-between font-mono text-[10.5px] text-ink-soft">
        <span className="tracking-[0.12em] uppercase">{scrap.kind}</span>
        <span>{scrap.ref}</span>
      </p>
      <p className="mt-1.5 text-[13.5px] leading-snug">{scrap.text}</p>
    </motion.div>
  );
}
