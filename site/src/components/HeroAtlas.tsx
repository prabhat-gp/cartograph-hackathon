"use client";

import { Check } from "lucide-react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import { WHY_RUN } from "@/lib/site";

// expressjs/express as Cartograph draws it. The loop: the map surveys itself,
// a cursor picks the response → browser arrow, and its why-trail unrolls.
const W = 128;
const H = 46;
const nodes = [
  { id: "app", x: 320, y: 64, label: "application", sub: "lib/application.js" },
  { id: "router", x: 120, y: 190, label: "router", sub: "router" },
  { id: "req", x: 320, y: 200, label: "request", sub: "lib/request.js" },
  { id: "res", x: 500, y: 190, label: "response", sub: "lib/response.js" },
  { id: "send", x: 410, y: 344, label: "send", sub: "npm · send" },
  { id: "browser", x: 566, y: 344, label: "browser", sub: "http client", external: true },
];
const at = (id: string) => nodes.find((n) => n.id === id)!;
const curve = (a: string, b: string) => {
  const p = at(a);
  const q = at(b);
  const y1 = p.y + H / 2;
  const y2 = q.y - H / 2;
  return `M${p.x} ${y1} C ${p.x} ${y1 + 44}, ${q.x} ${y2 - 44}, ${q.x} ${y2}`;
};
const edges: [string, string][] = [
  ["app", "router"],
  ["app", "req"],
  ["app", "res"],
  ["res", "send"],
];
const TARGET = { x: (500 + 566) / 2, y: (190 + H / 2 + 344 - H / 2) / 2 };

// Survey → aim → click → explain → rest, then again.
type Phase = "survey" | "aim" | "click" | "explain" | "rest";
const SCHEDULE: [Phase, number][] = [
  ["survey", 2600],
  ["aim", 1100],
  ["click", 500],
  ["explain", 5600],
  ["rest", 900],
];

export function HeroAtlas() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("survey");
  const [loop, setLoop] = useState(0);

  useEffect(() => {
    if (reduce) {
      setPhase("explain");
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

  const picked = phase === "click" || phase === "explain";
  const drawn = phase !== "rest";

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
      <div className="flex items-center justify-between border-b border-ink px-4 py-2.5 font-mono text-[11px] text-ink-soft">
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-forest" /> expressjs/express
        </span>
        <span>{picked ? "explaining 1 arrow" : phase === "survey" ? "surveying…" : "6 parts · 5 arrows"}</span>
      </div>

      <div className="survey-grid relative overflow-hidden rounded-b-[6px]">
        <svg viewBox="0 0 640 400" className="block w-full" role="img" aria-label="Express drawn as a map; the arrow from response to browser is explained">
          {edges.map(([a, b], i) => (
            <motion.path
              key={`${loop}-${a}${b}`}
              d={curve(a, b)}
              fill="none"
              stroke="var(--color-ink)"
              strokeWidth={1.5}
              initial={{ pathLength: 0, strokeOpacity: 0.5 }}
              animate={{ pathLength: drawn ? 1 : 0, strokeOpacity: picked ? 0.15 : 0.5 }}
              transition={{ duration: 0.7, delay: drawn ? 0.9 + i * 0.18 : 0, ease: "easeInOut" }}
            />
          ))}
          {/* The arrow being explained */}
          <motion.path
            key={`${loop}-why`}
            d={curve("res", "browser")}
            fill="none"
            stroke={picked ? "var(--color-vermilion)" : "var(--color-ink)"}
            strokeOpacity={picked ? 1 : 0.5}
            strokeWidth={picked ? 3 : 1.5}
            strokeDasharray={picked ? "7 6" : "0"}
            className={picked ? "route" : undefined}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: drawn ? 1 : 0 }}
            transition={{ duration: 0.7, delay: drawn && phase === "survey" ? 1.65 : 0 }}
          />
          <AnimatePresence>
            {picked && (
              <motion.g key="label" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <rect x={TARGET.x + 10} y={TARGET.y - 12} width="66" height="22" rx="3" fill="var(--color-vermilion)" />
                <text x={TARGET.x + 43} y={TARGET.y + 3} textAnchor="middle" className="fill-paper-light font-mono text-[11px]">
                  redirect
                </text>
              </motion.g>
            )}
          </AnimatePresence>

          {nodes.map((n, i) => {
            const lit = picked && (n.id === "res" || n.id === "browser");
            return (
              <motion.g
                key={`${loop}-${n.id}`}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: drawn ? (picked && !lit ? 0.3 : 1) : 0, scale: drawn ? 1 : 0.85 }}
                transition={{ type: "spring", stiffness: 260, damping: 20, delay: drawn ? 0.1 + i * 0.12 : 0 }}
                style={{ transformOrigin: `${n.x}px ${n.y}px` }}
              >
                <rect
                  x={n.x - W / 2}
                  y={n.y - H / 2}
                  width={W}
                  height={H}
                  rx="4"
                  fill="var(--color-paper-light)"
                  stroke={lit ? "var(--color-vermilion)" : "var(--color-ink)"}
                  strokeWidth={lit ? 2 : 1}
                  strokeDasharray={n.external ? "4 3" : undefined}
                />
                <text x={n.x - W / 2 + 12} y={n.y - 2} className="fill-ink font-sans text-[14px] font-medium">
                  {n.label}
                </text>
                <text x={n.x - W / 2 + 12} y={n.y + 14} className="fill-ink-soft font-mono text-[10px]">
                  {n.sub}
                </text>
              </motion.g>
            );
          })}

          {/* The visitor's cursor, and the ripple when it clicks */}
          <AnimatePresence>
            {(phase === "aim" || phase === "click") && (
              <motion.g
                key={`cursor-${loop}`}
                initial={{ x: 620, y: 400, opacity: 0 }}
                animate={{ x: TARGET.x, y: TARGET.y, opacity: 1, scale: phase === "click" ? 0.86 : 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 90, damping: 16 }}
              >
                <path d="M0 0 L0 18 L5 13 L9 22 L12 21 L8 12 L15 12 Z" fill="var(--color-ink)" stroke="var(--color-paper-light)" strokeWidth="1.2" />
              </motion.g>
            )}
            {phase === "click" && (
              <motion.circle
                key={`ripple-${loop}`}
                cx={TARGET.x}
                cy={TARGET.y}
                fill="none"
                stroke="var(--color-vermilion)"
                strokeWidth="2"
                initial={{ r: 4, opacity: 0.9 }}
                animate={{ r: 34, opacity: 0 }}
                transition={{ duration: 0.6 }}
              />
            )}
          </AnimatePresence>
        </svg>

        <AnimatePresence>
          {phase === "explain" && <WhyCard key={`card-${loop}`} />}
        </AnimatePresence>
      </div>
    </motion.figure>
  );
}

function WhyCard() {
  const steps = WHY_RUN.chain;
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, transition: { duration: 0.25 } }}
      transition={{ type: "spring", stiffness: 220, damping: 22 }}
      className="absolute bottom-[4%] left-[3%] w-[min(300px,58%)] rounded-[5px] border border-ink bg-paper-light p-3.5 shadow-[5px_5px_0_0_var(--color-ink)]"
    >
      <p className="font-mono text-[10px] tracking-[0.16em] text-vermilion uppercase">Why is this here?</p>
      <ol className="mt-2.5 space-y-1.5">
        {steps.map((s, i) => (
          <motion.li
            key={s.kind}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.35 + i * 0.42, type: "spring", stiffness: 300, damping: 24 }}
            className="flex items-center gap-2.5 text-[12.5px]"
          >
            <span className="grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] border-vermilion font-mono text-[9.5px] text-vermilion">{i + 1}</span>
            <span className="w-[74px] shrink-0 text-ink-soft">{s.kind}</span>
            <span className="truncate font-mono text-[11.5px]">{s.ref}</span>
          </motion.li>
        ))}
      </ol>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35 + steps.length * 0.42 + 0.1 }}
        className="mt-3 flex items-center gap-1.5 border-t border-rule pt-2.5 font-mono text-[10.5px] text-forest"
      >
        <Check className="size-3.5" /> Critic approved · {WHY_RUN.seconds} s
      </motion.p>
    </motion.div>
  );
}
