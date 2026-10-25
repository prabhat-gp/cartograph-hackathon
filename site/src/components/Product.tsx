"use client";

import { Check, CornerDownLeft, X } from "lucide-react";
import { AnimatePresence, motion, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { KyMap, type MapMode } from "./KyMap";
import { Mark } from "./Mark";
import { Stage, WhenSeen, scrollToStep, usePinnedStep } from "./Pinned";

const steps: { title: string; line: string; frame: () => React.ReactNode }[] = [
  { title: "Paste a repo", line: "Any public GitHub repository.", frame: () => <PasteFrame /> },
  { title: "Agents take it apart", line: "Readers work in parallel; a Verifier checks every quote.", frame: () => <SurveyFrame /> },
  { title: "A map you can trust", line: "Every arrow cites the line that proves it.", frame: () => <MapFrame mode="draw" /> },
  { title: "Ask why", line: "Click an arrow. Get the commit, PR and issue behind it.", frame: () => <MapFrame mode="why" /> },
  { title: "See what breaks", line: "Pick a part. Everything that depends on it lights up.", frame: () => <MapFrame mode="blast" /> },
  { title: "Follow it, keep it true", line: "Play a request end to end. Every push is re-checked.", frame: () => <FlowDriftFrame /> },
];

export function Product() {
  const ref = useRef<HTMLElement>(null);
  const { step, progress } = usePinnedStep(ref, steps.length);
  const bar = useTransform(progress, [0, 1], ["0%", "100%"]);

  return (
    <section id="product" ref={ref} className="relative border-t border-ink bg-paper">
      {/* Desktop: the desk stays pinned while the steps play */}
      <div className="hidden lg:block" style={{ height: `${steps.length * 85 + 15}vh` }}>
        <div className="sticky top-0 flex h-screen items-center">
          <div className="mx-auto grid w-full max-w-7xl grid-cols-[0.62fr_1.38fr] items-center gap-12 px-6">
            <div>
              <p className="font-mono text-[11px] tracking-[0.22em] text-vermilion uppercase">How it works</p>
              <ol className="mt-6 space-y-1">
                {steps.map((s, i) => (
                  <li key={s.title}>
                    <button
                      onClick={() => scrollToStep(ref.current, i, steps.length)}
                      className={`group w-full rounded-[4px] py-2.5 pr-3 pl-4 text-left transition-colors ${i === step ? "bg-paper-light" : "hover:bg-paper-light/60"}`}
                    >
                      <span className="flex items-baseline gap-3">
                        <span className={`font-mono text-xs transition-colors ${i === step ? "text-vermilion" : "text-ink-faint"}`}>{String(i + 1).padStart(2, "0")}</span>
                        <span className={`font-serif text-[26px] leading-tight transition-colors ${i === step ? "text-ink" : "text-ink-faint group-hover:text-ink-soft"}`}>{s.title}</span>
                      </span>
                      <AnimatePresence initial={false}>
                        {i === step && (
                          <motion.span
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3 }}
                            className="block overflow-hidden pl-8 text-[15px] text-ink-soft"
                          >
                            <span className="block pt-1">{s.line}</span>
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
            <DeskWindow step={step} bar={bar} />
          </div>
        </div>
      </div>

      {/* Phones and tablets: the same frames, one after another */}
      <div className="space-y-16 px-4 py-24 sm:px-6 lg:hidden">
        <p className="font-mono text-[11px] tracking-[0.22em] text-vermilion uppercase">How it works</p>
        {steps.map((s, i) => (
          <div key={s.title}>
            <p className="font-serif text-3xl">
              <span className="mr-2 font-mono text-xs text-vermilion">{String(i + 1).padStart(2, "0")}</span>
              {s.title}
            </p>
            <p className="mt-1 text-ink-soft">{s.line}</p>
            <WhenSeen className="mt-5 overflow-hidden rounded-[6px] border border-ink bg-paper-light">
              <Stage>{s.frame()}</Stage>
            </WhenSeen>
          </div>
        ))}
      </div>
    </section>
  );
}

function DeskWindow({ step, bar }: { step: number; bar: ReturnType<typeof useTransform<number, string>> }) {
  return (
    <div className="relative rounded-[8px] border border-ink bg-paper-light shadow-[12px_12px_0_0_var(--color-ink)]">
      <div className="flex items-center gap-3 border-b border-ink px-4 py-2.5">
        <span className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-2.5 rounded-full border border-ink/40" />
          ))}
        </span>
        <span className="flex items-center gap-2 rounded-full bg-paper px-3 py-0.5 font-mono text-[11px] text-ink-soft">
          <Mark className="size-3.5" /> cartograph / desk
        </span>
        <AnimatePresence>
          {step > 0 && (
            <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="ml-auto font-mono text-[11px] text-ink-soft">
              sindresorhus/ky
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="relative aspect-[16/10] overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 14, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
            transition={{ duration: 0.35 }}
            className="absolute inset-0"
          >
            {steps[step].frame()}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="h-[3px] bg-rule/50">
        <motion.div style={{ width: bar }} className="h-full bg-vermilion" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- frames

function Typed({ text, delay = 0, speed = 70 }: { text: string; delay?: number; speed?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      i += 1;
      setN(i);
      if (i < text.length) t = setTimeout(tick, speed);
    };
    t = setTimeout(tick, delay);
    return () => clearTimeout(t);
  }, [text, delay, speed]);
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && <span className="ml-px inline-block h-[1.1em] w-[2px] translate-y-[3px] animate-pulse bg-vermilion" />}
    </>
  );
}

function PasteFrame() {
  const repo = "sindresorhus/ky";
  const pressAt = 300 + repo.length * 70 + 250;
  return (
    <div className="grid h-full place-items-center bg-paper-light px-10">
      <div className="w-full max-w-[460px] text-center">
        <Mark className="mx-auto size-10" />
        <p className="mt-4 font-serif text-[30px] leading-tight">Reverse-engineer any codebase.</p>
        <div className="mt-6 flex items-center gap-2 rounded-[6px] border border-ink bg-paper p-1.5 pl-4 text-left shadow-[3px_3px_0_0_var(--color-ink)]">
          <span className="flex-1 font-mono text-[14px]">
            github.com/<Typed text={repo} delay={300} />
          </span>
          <motion.span
            initial={{ scale: 1 }}
            animate={{ scale: [1, 1, 0.92, 1], backgroundColor: ["var(--color-ink)", "var(--color-ink)", "var(--color-vermilion)", "var(--color-vermilion)"] }}
            transition={{ duration: 0.5, delay: pressAt / 1000, times: [0, 0.2, 0.5, 1] }}
            className="flex items-center gap-1.5 rounded-[4px] px-3 py-2 text-[13px] font-medium text-paper-light"
          >
            Map <CornerDownLeft className="size-3.5" />
          </motion.span>
        </div>
        <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: pressAt / 1000 + 0.4 }} className="mt-4 font-mono text-[12px] text-ink-soft">
          <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-vermilion" />
          99 files found · agents at work
        </motion.p>
      </div>
    </div>
  );
}

const readers = [
  { file: "source/core/Ky.ts", speed: 2.4 },
  { file: "source/utils/options.ts", speed: 1.6 },
  { file: "source/core/constants.ts", speed: 1.9 },
  { file: "source/errors/HTTPError.ts", speed: 1.3 },
  { file: "source/utils/timeout.ts", speed: 2.0 },
];
const stamps = [true, true, false, true, true, false, true, true, false, true];

function SurveyFrame() {
  return (
    <div className="grid h-full grid-cols-[1fr_0.8fr] gap-6 bg-paper-light p-6">
      <div className="flex flex-col gap-3">
        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3 rounded-[5px] border border-ink bg-paper px-3 py-2">
          <span className="font-mono text-[10.5px] tracking-[0.14em] text-vermilion uppercase">Scout</span>
          <span className="text-[13px]">12 parts to read · 5 readers</span>
          <Check className="ml-auto size-4 text-forest" />
        </motion.div>
        {readers.map((r, i) => (
          <motion.div key={r.file} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.08 }} className="rounded-[5px] border border-ink/30 bg-paper px-3 py-2">
            <p className="flex justify-between font-mono text-[11px]">
              <span>Reader {i + 1}</span>
              <span className="text-ink-soft">{r.file}</span>
            </p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-rule/60">
              <motion.div initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ delay: 0.4 + i * 0.1, duration: r.speed, ease: "easeInOut" }} className="h-full rounded-full bg-sea" />
            </div>
          </motion.div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.6 }} className="rounded-[5px] border border-ink bg-paper px-3 py-2">
          <span className="font-mono text-[10.5px] tracking-[0.14em] text-vermilion uppercase">Cartographer</span>
          <p className="mt-1 text-[13px]">Joining 5 reports into one map</p>
        </motion.div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.0 }} className="flex-1 rounded-[5px] border border-ink bg-paper px-3 py-2">
          <span className="font-mono text-[10.5px] tracking-[0.14em] text-vermilion uppercase">Verifier</span>
          <p className="mt-1 text-[13px]">Is each quote really in the code?</p>
          <div className="mt-3 grid grid-cols-5 gap-2">
            {stamps.map((ok, i) => (
              <motion.span
                key={i}
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 3.3 + i * 0.12, type: "spring", stiffness: 400, damping: 14 }}
                className={`grid aspect-square place-items-center rounded-full border-2 ${ok ? "border-forest text-forest" : "border-vermilion text-vermilion"}`}
              >
                {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
              </motion.span>
            ))}
          </div>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 4.7 }} className="mt-3 font-mono text-[11px] text-ink-soft">
            no citation, no arrow
          </motion.p>
        </motion.div>
      </div>
    </div>
  );
}

const trail = [
  { kind: "Code", ref: "constants.ts:263" },
  { kind: "Commit", ref: "68a5228" },
  { kind: "Pull request", ref: "#779" },
  { kind: "Issue", ref: "#778" },
];

function MapFrame({ mode }: { mode: MapMode }) {
  return (
    <div className="relative h-full bg-paper-light">
      <div className="survey-grid absolute inset-0 opacity-70" />
      {/* With a panel open, the map slides left under it instead of shrinking. */}
      <motion.div
        initial={false}
        animate={{ x: mode === "why" || mode === "blast" ? "-19%" : "0%" }}
        transition={{ type: "spring", stiffness: 120, damping: 20, delay: 0.1 }}
        className="relative h-full p-4"
      >
        <KyMap mode={mode} />
      </motion.div>
      {mode === "draw" && (
        <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.8 }} className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-forest px-3 py-1 font-mono text-[11px] text-paper-light">
          <Check className="size-3.5" /> 6 arrows, each proven in code
        </motion.p>
      )}
      {mode === "why" && (
        <SidePanel title="Core Request Logic → Retry Engine">
          <p className="font-mono text-[10px] tracking-[0.16em] text-vermilion uppercase">Why is this here?</p>
          <ol className="mt-3 space-y-2">
            {trail.map((t, i) => (
              <motion.li key={t.kind} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 + i * 0.35 }} className="flex items-center gap-2 text-[12px]">
                <span className="grid size-5 place-items-center rounded-full border-[1.5px] border-vermilion font-mono text-[9.5px] text-vermilion">{i + 1}</span>
                <span className="w-20 text-ink-soft">{t.kind}</span>
                <span className="font-mono text-[11px]">{t.ref}</span>
              </motion.li>
            ))}
          </ol>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2 }} className="mt-3 border-t border-rule pt-3 font-serif text-[15px] leading-snug">
            Added in #779 so hooks can force a retry, as issue #778 asked.
          </motion.p>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.4 }} className="mt-2 flex items-center gap-1.5 font-mono text-[10.5px] text-forest">
            <Check className="size-3.5" /> Critic approved
          </motion.p>
        </SidePanel>
      )}
      {mode === "blast" && (
        <SidePanel title="Retry Engine is down">
          <p className="font-mono text-[10px] tracking-[0.16em] text-vermilion uppercase">What breaks?</p>
          {[
            { name: "Core Request Logic", how: "direct" },
            { name: "Ky HTTP Client", how: "2 hops" },
          ].map((x, i) => (
            <motion.div key={x.name} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 + i * 0.3 }} className="mt-3 flex items-center justify-between rounded-[4px] border border-ochre/60 bg-ochre/10 px-2.5 py-2 text-[12.5px]">
              {x.name}
              <span className="font-mono text-[10.5px] text-ochre">{x.how}</span>
            </motion.div>
          ))}
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3 }} className="mt-3 text-[12px] text-ink-soft">
            2 parts affected
          </motion.p>
        </SidePanel>
      )}
    </div>
  );
}

function SidePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.aside
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      transition={{ type: "spring", stiffness: 160, damping: 22, delay: 0.15 }}
      className="absolute inset-y-0 right-0 w-[40%] border-l border-ink bg-paper p-4"
    >
      <p className="font-serif text-[19px] leading-tight">{title}</p>
      <div className="mt-3">{children}</div>
    </motion.aside>
  );
}

function FlowDriftFrame() {
  const [part, setPart] = useState<"flow" | "drift">("flow");
  useEffect(() => {
    const t = setInterval(() => setPart((p) => (p === "flow" ? "drift" : "flow")), 4200);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="relative h-full bg-paper-light">
      <div className="survey-grid absolute inset-0 opacity-70" />
      <div className="relative h-full p-4">
        <KyMap key={part} mode={part} />
      </div>
      <AnimatePresence mode="wait">
        {part === "flow" ? (
          <motion.p key="flow" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute bottom-4 left-4 rounded-full bg-sea px-3 py-1 font-mono text-[11px] text-paper-light">
            ▶ Flow · Error Construction and Throwing
          </motion.p>
        ) : (
          <motion.div key="drift" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-[5px] border border-ink bg-paper px-3 py-1.5 text-[12px] shadow-[3px_3px_0_0_var(--color-ink)]">
            <span className="rounded-[3px] bg-vermilion px-1.5 py-0.5 font-mono text-[9.5px] text-paper-light">DRIFT</span>
            New push: Hook System now calls Timeout
            <span className="font-mono text-[10px] text-ink-faint">example</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
