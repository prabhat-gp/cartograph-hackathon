"use client";

import { Check } from "lucide-react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import { HERO_RUN } from "@/lib/site";

// The whole product in one loop, on real PrepPilot data: a scan line reads the
// code and every call it passes lifts into the map; then the ground under one
// arrow opens into the history behind it, and the Critic signs off.
type Phase = "scan" | "map" | "pick" | "dig" | "rest";
const SCHEDULE: [Phase, number][] = [
  ["scan", 3000],
  ["map", 2600],
  ["pick", 800],
  ["dig", 6200],
  ["rest", 700],
];
const SCAN_S = 2.4;

const { file, firstLine, code, hits } = HERO_RUN;

const W = 138;
const H = 46;
const nodes = [
  { id: "gateway", x: 180, y: 52, label: "API gateway", sub: "spring cloud gateway" },
  { id: "ai", x: 180, y: 182, label: "AI orchestration", sub: "ai-service · fastapi" },
  { id: "gemini", x: 96, y: 330, label: "Gemini", sub: "model provider" },
  { id: "openai", x: 264, y: 330, label: "OpenAI", sub: "model provider" },
];
const at = (id: string) => nodes.find((n) => n.id === id)!;
const curve = (a: string, b: string) => {
  const p = at(a);
  const q = at(b);
  const y1 = p.y + H / 2;
  const y2 = q.y - H / 2;
  return `M${p.x} ${y1} C ${p.x} ${y1 + 50}, ${q.x} ${y2 - 50}, ${q.x} ${y2}`;
};
const edges = [
  { id: "gw-ai", from: "gateway", to: "ai", cite: "application.yml:45", tx: 186, ty: 122 },
  { id: "ai-gemini", from: "ai", to: "gemini", cite: "llm.py:26", tx: 34, ty: 262 },
  { id: "ai-openai", from: "ai", to: "openai", cite: "llm.py:34", tx: 250, ty: 262 },
];
const PICK = { x: 128, y: 262 };

export function HeroXray() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("scan");
  const [loop, setLoop] = useState(0);

  useEffect(() => {
    if (reduce) {
      setPhase("dig");
      return;
    }
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(() => {
        i = (i + 1) % SCHEDULE.length;
        if (i === 0) setLoop((n) => n + 1);
        setPhase(SCHEDULE[i][0]);
        next();
      }, SCHEDULE[i][1]);
    };
    next();
    return () => clearTimeout(t);
  }, [reduce]);

  // A slight tilt toward the pointer, so the plate feels like paper on a desk.
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [3, -3]), { stiffness: 120, damping: 18 });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-4, 4]), { stiffness: 120, damping: 18 });

  const scanning = phase === "scan";
  const mapped = phase !== "scan" && phase !== "rest";
  const picked = phase === "pick" || phase === "dig";
  const status = scanning ? "reading the code…" : phase === "map" ? "4 parts · 3 arrows · each cited" : picked ? "explaining 1 arrow" : "";

  return (
    <motion.figure
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width - 0.5);
        my.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onPointerLeave={() => {
        mx.set(0);
        my.set(0);
      }}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 1200 }}
      className="relative rounded-[6px] border border-ink bg-paper-light shadow-[10px_10px_0_0_var(--color-ink)]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-ink px-4 py-2.5 font-mono text-[11px] text-ink-soft">
        <span className="flex min-w-0 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-forest" />
          <span className="truncate">{HERO_RUN.repo}</span>
        </span>
        <AnimatePresence mode="wait">
          <motion.span key={status} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="shrink-0">
            {status}
          </motion.span>
        </AnimatePresence>
      </div>

      <div className="survey-grid relative aspect-[3/4] overflow-hidden sm:aspect-[16/11] rounded-b-[6px]">
        {/* The code. Full width while it's read, then it steps back behind the map. */}
        <motion.div
          className="absolute inset-y-0 left-0 overflow-hidden border-r border-rule bg-paper-light/90"
          initial={false}
          animate={{ width: scanning || phase === "rest" ? "100%" : "46%", opacity: picked ? 0.35 : 1 }}
          transition={{ type: "spring", stiffness: 120, damping: 22 }}
        >
          <p className="border-b border-rule px-3 py-1.5 font-mono text-[10px] tracking-[0.12em] text-ink-faint uppercase">{file}</p>
          <pre className="m-0 py-1.5 font-mono text-[10.5px] leading-[1.62] sm:text-[11.5px]">
            {code.map((text, i) => {
              const line = firstLine + i;
              const hit = hits.find((h) => h.line === line);
              const lit = hit && !scanning ? true : false;
              return (
                <div key={line} className="relative flex whitespace-pre">
                  {hit && (
                    <motion.span
                      key={`${loop}-${line}`}
                      className="absolute inset-0 bg-vermilion/12"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: reduce || lit ? 1 : [0, 0, 1] }}
                      transition={{ duration: SCAN_S, times: [0, i / code.length, Math.min(1, i / code.length + 0.04)] }}
                    />
                  )}
                  <span className="relative w-8 shrink-0 pr-2 text-right text-ink-faint select-none">{line}</span>
                  <span className={`relative ${hit ? "text-ink" : "text-ink-soft"}`}>{text}</span>
                  {hit && (
                    <motion.span
                      key={`tag-${loop}-${line}`}
                      className="relative ml-2 rounded-[3px] bg-vermilion px-1.5 text-[9.5px] text-paper-light"
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: reduce ? 0 : (i / code.length) * SCAN_S + 0.1 }}
                    >
                      → {hit.to}
                    </motion.span>
                  )}
                </div>
              );
            })}
          </pre>
          {scanning && !reduce && (
            <motion.div
              key={`scan-${loop}`}
              className="pointer-events-none absolute inset-x-0 h-8 border-b-2 border-vermilion bg-gradient-to-b from-transparent to-vermilion/15"
              initial={{ top: "8%" }}
              animate={{ top: "100%" }}
              transition={{ duration: SCAN_S, ease: "linear" }}
            />
          )}
        </motion.div>

        {/* The map the calls lift into */}
        <motion.div
          className="absolute inset-y-0 right-0 w-[54%]"
          initial={false}
          animate={{ opacity: mapped ? 1 : 0 }}
          transition={{ duration: 0.3 }}
        >
          <svg viewBox="0 0 360 400" className="h-full w-full" role="img" aria-label="PrepPilot's AI service drawn as a map, each arrow cited to a line of code">
            {edges.map((e, i) => {
              const hot = picked && e.id === "ai-gemini";
              return (
                <g key={`${loop}-${e.id}`}>
                  <motion.path
                    d={curve(e.from, e.to)}
                    fill="none"
                    stroke={hot ? "var(--color-vermilion)" : "var(--color-ink)"}
                    strokeWidth={hot ? 3 : 1.5}
                    strokeDasharray={hot ? "7 6" : undefined}
                    className={hot ? "route" : undefined}
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: mapped ? 1 : 0, strokeOpacity: picked && !hot ? 0.15 : hot ? 1 : 0.55 }}
                    transition={{ duration: 0.6, delay: mapped && phase === "map" ? 0.5 + i * 0.25 : 0 }}
                  />
                  <motion.text
                    x={e.tx}
                    y={e.ty}
                    className={`font-mono text-[11px] ${hot ? "fill-vermilion" : "fill-forest"}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: mapped ? (picked && !hot ? 0.2 : 1) : 0 }}
                    transition={{ delay: mapped && phase === "map" ? 0.9 + i * 0.25 : 0 }}
                  >
                    {e.cite}
                  </motion.text>
                </g>
              );
            })}
            {nodes.map((n, i) => {
              const lit = picked && (n.id === "ai" || n.id === "gemini");
              return (
                <motion.g
                  key={`${loop}-${n.id}`}
                  initial={{ opacity: 0, scale: 0.8, x: -40 }}
                  animate={{ opacity: mapped ? (picked && !lit ? 0.3 : 1) : 0, scale: mapped ? 1 : 0.8, x: mapped ? 0 : -40 }}
                  transition={{ type: "spring", stiffness: 240, damping: 20, delay: mapped && phase === "map" ? i * 0.12 : 0 }}
                  style={{ transformOrigin: `${n.x}px ${n.y}px` }}
                >
                  <rect x={n.x - W / 2} y={n.y - H / 2} width={W} height={H} rx="5" fill="var(--color-paper-light)" stroke={lit ? "var(--color-vermilion)" : "var(--color-ink)"} strokeWidth={lit ? 2 : 1} />
                  <text x={n.x - W / 2 + 12} y={n.y - 2} className="fill-ink font-sans text-[14px] font-medium">
                    {n.label}
                  </text>
                  <text x={n.x - W / 2 + 12} y={n.y + 14} className="fill-ink-soft font-mono text-[10px]">
                    {n.sub}
                  </text>
                </motion.g>
              );
            })}
            <AnimatePresence>
              {phase === "pick" && (
                <motion.g key={`cursor-${loop}`} initial={{ x: 340, y: 400, opacity: 0 }} animate={{ x: PICK.x, y: PICK.y, opacity: 1 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 110, damping: 16 }}>
                  <path d="M0 0 L0 18 L5 13 L9 22 L12 21 L8 12 L15 12 Z" fill="var(--color-ink)" stroke="var(--color-paper-light)" strokeWidth="1.2" />
                </motion.g>
              )}
              {phase === "dig" && !reduce && (
                <motion.circle key={`ripple-${loop}`} cx={PICK.x} cy={PICK.y} fill="none" stroke="var(--color-vermilion)" strokeWidth="2" initial={{ r: 4, opacity: 0.9 }} animate={{ r: 34, opacity: 0 }} transition={{ duration: 0.6 }} />
              )}
            </AnimatePresence>
          </svg>
        </motion.div>

        {/* The ground under the arrow opens: line, commit, pull request, answer. */}
        <AnimatePresence>{phase === "dig" && <Strata key={`strata-${loop}`} instant={!!reduce} />}</AnimatePresence>
      </div>
    </motion.figure>
  );
}

const LAYER_TONES = ["bg-paper-light", "bg-paper", "bg-paper-deep"];

function Strata({ instant }: { instant: boolean }) {
  const d = (s: number) => (instant ? 0 : s);
  const answer = HERO_RUN.answer;
  return (
    <motion.div
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%", transition: { duration: 0.3 } }}
      transition={{ type: "spring", stiffness: 160, damping: 22 }}
      className="absolute inset-y-0 left-0 flex w-full flex-col border-r border-ink bg-paper-light sm:w-[46%]"
    >
      <p className="px-4 pt-2.5 pb-1.5 font-mono text-[10px] tracking-[0.16em] text-vermilion uppercase">Why is this arrow here?</p>
      <ol className="m-0 list-none p-0">
        {HERO_RUN.chain.map((s, i) => (
          <motion.li
            key={s.kind}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: d(0.35 + i * 0.45), type: "spring", stiffness: 300, damping: 24 }}
            className={`border-t border-rule px-4 py-2 ${LAYER_TONES[i]}`}
          >
            <span className="flex items-baseline justify-between gap-2 font-mono text-[10px] tracking-wide text-ink-soft uppercase">
              {s.kind} <span className="text-[11px] tracking-normal text-ink normal-case">{s.ref}</span>
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-ink-soft">{s.title}</span>
          </motion.li>
        ))}
      </ol>
      <div className="mt-auto border-t border-ink px-4 py-3">
        <p className="m-0 font-serif text-[16px] leading-snug sm:text-[17px]">
          {answer.split(" ").map((w, i) => (
            <motion.span key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: d(1.9 + i * 0.07) }}>
              {w}{" "}
            </motion.span>
          ))}
        </p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: d(1.9 + answer.split(" ").length * 0.07 + 0.2) }}
          className="mt-1.5 mb-0 flex items-center gap-1.5 font-mono text-[10.5px] text-forest"
        >
          <Check className="size-3.5" /> Critic approved · {HERO_RUN.seconds} s · every claim cited
        </motion.p>
      </div>
    </motion.div>
  );
}
