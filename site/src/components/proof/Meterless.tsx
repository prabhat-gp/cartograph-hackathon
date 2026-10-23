"use client";

import { Brain, Check, CircleDot } from "lucide-react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import { HMEM_LEDGER } from "@/lib/site";

const OCHRE = "var(--color-ochre-light)";

// ------------------------------------------------------------ Build: H-MEM

/** A real memory (.cartograph/memory/sindresorhus__ky), written when the Critic approved an answer. */
function MemoryCard({ state }: { state: "new" | "recalled" | "stale" }) {
  return (
    <motion.div
      layout
      className={`relative w-[300px] rounded-[5px] border p-3.5 font-mono text-[11px] transition-colors ${state === "stale" ? "border-paper/15 bg-[#1b1915] text-paper/40" : "border-ochre-light/60 bg-[#1b1915] text-paper/80"}`}
      animate={state === "recalled" ? { boxShadow: ["0 0 0 0 rgba(227,178,94,0)", "0 0 0 8px rgba(227,178,94,0.18)", "0 0 0 0 rgba(227,178,94,0)"] } : {}}
      transition={{ duration: 1.6, repeat: state === "recalled" ? Infinity : 0 }}
    >
      <p className="flex items-center gap-1.5 text-[10px] tracking-[0.14em] uppercase" style={{ color: state === "stale" ? undefined : OCHRE }}>
        <Brain className="size-3.5" /> H-MEM · long-term
      </p>
      <p className="mt-2 font-sans text-[13px] leading-snug">ky.retry() creates a RetryMarker to signal forced retries.</p>
      <div className="mt-2.5 space-y-0.5 text-[10.5px]">
        <p>
          source <span className="text-paper/55">critic-approved</span>
        </p>
        <p>
          confidence <span className="text-paper/55">0.85</span>
        </p>
        <p>
          refs <span className="text-paper/55">constants.ts:263</span>
        </p>
      </div>
      {state === "stale" && (
        <motion.span
          initial={{ scale: 1.6, opacity: 0, rotate: -14 }}
          animate={{ scale: 1, opacity: 1, rotate: -8 }}
          transition={{ type: "spring", stiffness: 300, damping: 14 }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[4px] border-2 border-[#f08a73] px-3 py-1 font-mono text-[13px] tracking-[0.2em] text-[#f08a73]"
        >
          STALE
        </motion.span>
      )}
    </motion.div>
  );
}

export function MemorySave() {
  return (
    <div className="grid h-full grid-cols-2 items-center gap-6 p-7">
      <motion.div initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} className="rounded-[5px] border border-paper/20 p-4">
        <p className="font-mono text-[10px] tracking-[0.14em] text-paper/50 uppercase">Answer · Core → Retry Engine</p>
        <p className="mt-2 font-serif text-[17px] leading-snug text-paper-light">Added in #779 so hooks can force a retry, as issue #778 asked.</p>
        <motion.p initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.6, type: "spring" }} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-forest-light/15 px-2.5 py-1 font-mono text-[10.5px] text-forest-light">
          <Check className="size-3.5" /> Critic approved
        </motion.p>
      </motion.div>
      <div className="relative grid place-items-center">
        <motion.div initial={{ x: -160, y: -20, opacity: 0, scale: 0.7, rotate: -6 }} animate={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }} transition={{ delay: 1.1, type: "spring", stiffness: 90, damping: 15 }}>
          <MemoryCard state="new" />
        </motion.div>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.2 }} className="mt-3 font-mono text-[11px] text-paper/50">
          remembered, with its sources
        </motion.p>
      </div>
    </div>
  );
}

export function MemoryRecall() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-7">
      <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="rounded-full border border-paper/25 px-4 py-2 text-[14px] text-paper-light">
        Next question: <span className="text-paper/70">“Why does Core depend on Retry Engine?”</span>
      </motion.p>
      <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.6, type: "spring", stiffness: 120, damping: 16 }}>
        <MemoryCard state="recalled" />
      </motion.div>
      <motion.p initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.4 }} className="flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[11px]" style={{ background: "rgba(227,178,94,0.15)", color: OCHRE }}>
        <Brain className="size-3.5" /> 1 recalled from memory · the agents start from it
      </motion.p>
    </div>
  );
}

function Counter({ to, delay }: { to: number; delay: number }) {
  const v = useMotionValue(0);
  const shown = useTransform(v, (x) => Math.round(x));
  useEffect(() => {
    const c = animate(v, to, { duration: 1.2, delay, ease: "easeOut" });
    return () => c.stop();
  }, [v, to, delay]);
  return <motion.span>{shown}</motion.span>;
}

export function MemoryForget() {
  const ky = HMEM_LEDGER[0];
  return (
    <div className="grid h-full grid-cols-[1fr_0.9fr] items-center gap-6 p-7">
      <div className="space-y-4">
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="rounded-[4px] border border-paper/20 bg-[#1b1915] p-3 font-mono text-[11px]">
          <p className="text-paper/50">when source/core/constants.ts:263 changes</p>
          <p className="mt-1.5 bg-[#f08a73]/10 text-[#f08a73]">- export const retry = (options) =&gt; …</p>
          <p className="bg-forest-light/10 text-forest-light">+ export const retry = …</p>
        </motion.div>
        <motion.div initial={{ opacity: 1 }} animate={{ opacity: 1 }}>
          <MemoryCard state="stale" />
        </motion.div>
      </div>
      <div className="space-y-3">
        <p className="font-mono text-[10.5px] tracking-[0.14em] text-paper/50 uppercase">Trust ledger · {ky.repo}</p>
        {[
          { label: "created", n: ky.created },
          { label: "recalled", n: ky.reads },
          { label: "updated", n: ky.updates },
        ].map((r, i) => (
          <div key={r.label} className="flex items-baseline justify-between border-b border-paper/10 pb-2">
            <span className="text-[14px] text-paper/70">{r.label}</span>
            <span className="font-serif text-4xl text-paper-light">
              <Counter to={r.n} delay={0.4 + i * 0.15} />
            </span>
          </div>
        ))}
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6 }} className="flex items-center gap-1.5 pt-1 font-mono text-[11px] text-forest-light">
          <Check className="size-3.5" /> 13 / 13 H-MEM conformance checks
        </motion.p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Power: Runtime

const status = [
  { name: "Meterless Nightshift", role: "primary AI provider", dot: OCHRE, word: "primary" },
  { name: "NVIDIA Nemotron", role: "the models", dot: "var(--color-forest-light)", word: "working" },
  { name: "Zetaris", role: "provenance USL", dot: "var(--color-forest-light)", word: "working" },
  { name: "Meterless H-MEM", role: "memory engine", dot: "var(--color-forest-light)", word: "working" },
];

export function RuntimePanel() {
  return (
    <div className="grid h-full place-items-center p-7">
      <motion.div initial={{ opacity: 0, y: -10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="w-[360px] rounded-[5px] border border-paper/25 bg-[#1b1915] p-4">
        <p className="font-serif text-[22px] text-paper-light">Powered by</p>
        <ul className="mt-3 space-y-3">
          {status.map((s, i) => (
            <motion.li key={s.name} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.15 }} className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-[13.5px] font-medium text-paper-light">{s.name}</span>
                <span className="font-mono text-[10px] tracking-[0.1em] text-paper/45 uppercase">{s.role}</span>
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-paper/60">
                <motion.span animate={{ scale: [1, 1.35, 1] }} transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.2 }} className="size-2 rounded-full" style={{ background: s.dot }} />
                {s.word}
              </span>
            </motion.li>
          ))}
        </ul>
        <p className="mt-4 border-t border-paper/10 pt-3 font-mono text-[10.5px] text-paper/45">live in the desk header</p>
      </motion.div>
    </div>
  );
}

function Station({ x, y, label, sub, dim, accent }: { x: number; y: number; label: string; sub: string; dim?: boolean; accent?: string }) {
  return (
    <g opacity={dim ? 0.3 : 1}>
      <rect x={x - 70} y={y - 26} width="140" height="52" rx="6" fill="#1b1915" stroke={accent ?? "rgba(242,237,225,0.35)"} strokeWidth={accent ? 1.6 : 1} />
      <text x={x} y={y - 3} textAnchor="middle" className="fill-paper-light font-sans text-[13px] font-medium">
        {label}
      </text>
      <text x={x} y={y + 14} textAnchor="middle" className="font-mono text-[10px]" fill="rgba(242,237,225,0.5)">
        {sub}
      </text>
    </g>
  );
}

/** Every agent call goes app → Nightshift → Nemotron; if the runtime is unreachable, NVIDIA answers directly. */
export function RuntimeRoute({ offline }: { offline?: boolean }) {
  const [loop, setLoop] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setLoop((n) => n + 1), 2600);
    return () => clearInterval(t);
  }, []);
  const via = "M150 120 L 330 120 L 510 120";
  const direct = "M150 120 C 230 240, 430 240, 510 120";
  return (
    <div className="relative h-full p-5">
      <svg viewBox="0 0 660 300" className="h-full w-full" aria-label={offline ? "Runtime offline: the call goes to NVIDIA directly" : "Agent call through Meterless Nightshift to Nemotron"}>
        <path d={via} fill="none" stroke="rgba(242,237,225,0.25)" strokeWidth="1.5" strokeDasharray="5 5" opacity={offline ? 0.3 : 1} />
        {offline && <motion.path d={direct} fill="none" stroke="var(--color-forest-light)" strokeWidth="2" strokeDasharray="6 5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.5, duration: 0.8 }} />}
        <Station x={80} y={120} label="Cartograph agent" sub="tier: deep" accent="var(--color-paper)" />
        <Station x={330} y={120} label="Nightshift" sub=":8088 · meterless/deep" dim={offline} accent={offline ? undefined : OCHRE} />
        <Station x={580} y={120} label="NVIDIA Nemotron" sub="ultra-550b" accent="var(--color-forest-light)" />
        {offline && (
          <motion.g initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring" }} style={{ transformOrigin: "330px 80px" }}>
            <rect x="290" y="70" width="80" height="20" rx="4" fill="#f08a73" />
            <text x="330" y="84" textAnchor="middle" className="fill-ink font-mono text-[10px] font-medium">
              OFFLINE
            </text>
          </motion.g>
        )}
        <motion.circle
          key={loop}
          r="7"
          fill={offline ? "var(--color-forest-light)" : OCHRE}
          initial={{ offsetDistance: "0%" }}
          animate={{ offsetDistance: "100%" }}
          transition={{ duration: 1.6, ease: "easeInOut" }}
          style={{ offsetPath: `path("${offline ? direct : via}")` }}
        />
      </svg>
      <div className="absolute inset-x-6 bottom-5 flex flex-wrap gap-2 font-mono text-[10.5px]">
        {(offline
          ? ["runtime unreachable → NVIDIA direct", "runtime answered → its answer stands"]
          : ["Authorization: Bearer <token>", "meterless-app: cartograph", "meterless-scope: user", "model: meterless/deep"]
        ).map((h, i) => (
          <motion.span key={h} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + i * 0.15 }} className="rounded-full border border-paper/20 px-2.5 py-1 text-paper/70">
            {h}
          </motion.span>
        ))}
      </div>
      {!offline && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} className="absolute top-5 right-6 flex items-center gap-1.5 font-mono text-[10.5px] text-paper/50">
          <CircleDot className="size-3.5" style={{ color: OCHRE }} /> Runtime 1.4 contract
        </motion.p>
      )}
    </div>
  );
}
