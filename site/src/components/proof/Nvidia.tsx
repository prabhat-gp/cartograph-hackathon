"use client";

import { Check, ShieldCheck } from "lucide-react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";
import { USAGE } from "@/lib/site";

const GREEN = "var(--color-forest-light)";

// Which model each agent runs on (src/config.ts, src/agent/agents.ts, src/server/brain/run.ts).
const crew = [
  { name: "Scout", model: "Super / Ultra", job: "plans the reading" },
  { name: "Readers", model: "Lightning", job: "read files in parallel" },
  { name: "Cartographer", model: "Super / Ultra", job: "joins the map" },
  { name: "Verifier", model: "code", job: "checks every quote" },
  { name: "Reviewer", model: "Super / Ultra", job: "reviews each push" },
  { name: "Tracer", model: "Lightning", job: "answers on the map" },
  { name: "Writer", model: "Lightning", job: "drafts the why" },
  { name: "Critic", model: "Ultra", job: "checks every claim" },
];

export function NvidiaCrew() {
  return (
    <div className="grid h-full grid-cols-4 content-center gap-3 p-7">
      {crew.map((c, i) => (
        <motion.div
          key={c.name}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 + i * 0.12, type: "spring", stiffness: 240, damping: 20 }}
          whileHover={{ y: -4 }}
          className="rounded-[5px] border border-paper/20 bg-[#1b1915] p-3"
        >
          <p className="text-[14px] font-medium text-paper-light">{c.name}</p>
          <p className="mt-0.5 text-[11.5px] text-paper/50">{c.job}</p>
          <motion.p
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.8 + i * 0.12, type: "spring", stiffness: 400, damping: 15 }}
            className="mt-2.5 inline-block rounded-full px-2 py-0.5 font-mono text-[10px]"
            style={c.model === "code" ? { border: "1px solid rgba(242,237,225,0.25)", color: "rgba(242,237,225,0.6)" } : { background: "rgba(127,191,154,0.16)", color: GREEN }}
          >
            {c.model === "code" ? "plain code" : `Nemotron ${c.model}`}
          </motion.p>
        </motion.div>
      ))}
    </div>
  );
}

function Bar({ label, calls, tokens, max, delay }: { label: string; calls: number; tokens: number; max: number; delay: number }) {
  const v = useMotionValue(0);
  const shown = useTransform(v, (x) => Math.round(x).toLocaleString("en-US"));
  const width = useTransform(v, (x) => `${(x / max) * 100}%`);
  useEffect(() => {
    const c = animate(v, tokens, { duration: 1.6, delay, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [v, tokens, delay]);
  return (
    <div>
      <div className="flex items-baseline justify-between font-mono text-[11.5px]">
        <span className="text-paper/80">{label}</span>
        <span className="text-paper/50">{calls} calls</span>
      </div>
      <div className="mt-2 h-9 overflow-hidden rounded-[4px] bg-paper/5">
        <motion.div style={{ width, background: GREEN }} className="flex h-full items-center justify-end rounded-[4px] pr-3">
          <motion.span className="font-mono text-[12px] font-medium text-ink">{shown}</motion.span>
        </motion.div>
      </div>
    </div>
  );
}

export function NvidiaUsage() {
  const max = Math.max(...USAGE.rows.map((r) => r.tokens));
  return (
    <div className="flex h-full flex-col justify-center gap-6 px-9">
      <p className="font-mono text-[10.5px] tracking-[0.16em] text-paper/50 uppercase">Tokens per model · usage ledger · {USAGE.measured}</p>
      {USAGE.rows.map((r, i) => (
        <Bar key={r.model} label={r.model} calls={r.calls} tokens={r.tokens} max={max} delay={0.2 + i * 0.25} />
      ))}
      <p className="font-mono text-[11px] text-paper/50">every call logged · daily caps keep the free quota for judging</p>
    </div>
  );
}

/** Free-tier strict JSON runs away, so output is validated and repaired, never trusted blindly. */
export function NvidiaGuard() {
  const lines = [
    { t: "model output → checked against the schema", tone: "text-paper/70", d: 0.1 },
    { t: "✗ a field is missing or malformed", tone: "text-[#f08a73]", d: 0.8 },
    { t: "↻ keep what's valid, one repair turn", tone: "text-ochre-light", d: 1.4 },
    { t: "✓ valid, or the call fails loudly", tone: "text-forest-light", d: 2.0 },
  ];
  return (
    <div className="grid h-full grid-cols-[1.1fr_0.9fr] items-center gap-6 p-8">
      <div className="space-y-2 rounded-[5px] border border-paper/20 bg-[#1b1915] p-4 font-mono text-[12px]">
        {lines.map((l) => (
          <motion.p key={l.t} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: l.d }} className={l.tone}>
            {l.t}
          </motion.p>
        ))}
      </div>
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 2.3, type: "spring" }} className="text-center">
        <ShieldCheck className="mx-auto size-14" style={{ color: GREEN }} />
        <p className="mt-3 font-serif text-[24px] leading-tight text-paper-light">No broken JSON reaches the map.</p>
        <p className="mt-2 flex items-center justify-center gap-1.5 font-mono text-[11px] text-paper/55">
          <Check className="size-3.5" /> zod validation · repair turn
        </p>
      </motion.div>
    </div>
  );
}
