"use client";

import { AnimatePresence, motion } from "motion/react";

// sindresorhus/ky as Cartograph mapped it (22 Oct): real parts, real arrows,
// real citations. Each mode is one moment of using the desk.
export type MapMode = "draw" | "why" | "blast" | "flow" | "drift";

const W = 116;
const H = 38;
const nodes = [
  { id: "client", x: 280, y: 40, label: "Ky HTTP Client" },
  { id: "core", x: 280, y: 150, label: "Core Request Logic" },
  { id: "errors", x: 486, y: 150, label: "Error Types" },
  { id: "options", x: 74, y: 266, label: "Options" },
  { id: "hooks", x: 214, y: 272, label: "Hook System" },
  { id: "retry", x: 350, y: 272, label: "Retry Engine" },
  { id: "timeout", x: 486, y: 266, label: "Timeout" },
];
const edges = [
  { id: "client-core", from: "client", to: "core", cite: "index.ts:19" },
  { id: "core-errors", from: "core", to: "errors", cite: "Ky.ts:1" },
  { id: "core-options", from: "core", to: "options", cite: "Ky.ts:33" },
  { id: "core-hooks", from: "core", to: "hooks", cite: "Ky.ts:354" },
  { id: "core-retry", from: "core", to: "retry", cite: "constants.ts:263" },
  { id: "core-timeout", from: "core", to: "timeout", cite: "Ky.ts:34" },
];
const node = (id: string) => nodes.find((n) => n.id === id)!;

function path(from: string, to: string) {
  const a = node(from);
  const b = node(to);
  if (Math.abs(a.y - b.y) < 20) return `M${a.x + W / 2} ${a.y} L${b.x - W / 2} ${b.y}`;
  const y1 = a.y + H / 2;
  const y2 = b.y - H / 2;
  return `M${a.x} ${y1} C ${a.x} ${y1 + 40}, ${b.x} ${y2 - 40}, ${b.x} ${y2}`;
}
/** Where an arrow's citation sits: above the box it points to, or beside a short arrow. */
function citeAt(from: string, to: string): { x: number; y: number; anchor: "start" | "middle" } {
  const a = node(from);
  const b = node(to);
  if (Math.abs(a.y - b.y) < 20) return { x: (a.x + W / 2 + b.x - W / 2) / 2, y: a.y - 7, anchor: "middle" };
  if (a.x === b.x) return { x: a.x + 8, y: (a.y + H / 2 + b.y - H / 2) / 2 + 4, anchor: "start" };
  return { x: b.x, y: b.y - H / 2 - 7, anchor: "middle" };
}

type Look = { stroke: string; width: number; opacity: number; dash?: string; walk?: boolean };
const BASE: Look = { stroke: "var(--color-ink)", width: 1.4, opacity: 0.55 };

function looks(mode: MapMode) {
  const node: Record<string, { ring?: string; dim?: boolean; badge?: { text: string; color: string } }> = {};
  const edge: Record<string, Look> = {};
  const dimAll = () => {
    nodes.forEach((n) => (node[n.id] = { dim: true }));
    edges.forEach((e) => (edge[e.id] = { ...BASE, opacity: 0.14 }));
  };
  if (mode === "why") {
    dimAll();
    node.core = { ring: "var(--color-vermilion)" };
    node.retry = { ring: "var(--color-vermilion)" };
    edge["core-retry"] = { stroke: "var(--color-vermilion)", width: 2.6, opacity: 1, dash: "7 6", walk: true };
  }
  if (mode === "blast") {
    dimAll();
    node.retry = { ring: "var(--color-vermilion)", badge: { text: "DOWN", color: "var(--color-vermilion)" } };
    node.core = { ring: "var(--color-ochre)", badge: { text: "direct", color: "var(--color-ochre)" } };
    node.client = { ring: "var(--color-ochre)", badge: { text: "2 hops", color: "var(--color-ochre)" } };
    edge["core-retry"] = { stroke: "var(--color-vermilion)", width: 2.4, opacity: 1 };
    edge["client-core"] = { stroke: "var(--color-ochre)", width: 2.2, opacity: 1 };
  }
  if (mode === "flow") {
    dimAll();
    ["client", "core", "errors"].forEach((id) => (node[id] = {}));
    edge["client-core"] = { stroke: "var(--color-sea)", width: 2.2, opacity: 0.9 };
    edge["core-errors"] = { stroke: "var(--color-sea)", width: 2.2, opacity: 0.9 };
  }
  if (mode === "drift") {
    dimAll();
    node.hooks = { ring: "var(--color-vermilion)", badge: { text: "changed", color: "var(--color-vermilion)" } };
    node.timeout = {};
  }
  return { node, edge };
}

export function KyMap({ mode }: { mode: MapMode }) {
  const intro = mode === "draw";
  const { node: nl, edge: el } = looks(mode);

  return (
    <svg viewBox="0 0 560 310" className="block h-full w-full" role="img" aria-label="sindresorhus/ky drawn by Cartograph">
      {edges.map((e, i) => {
        const look = el[e.id] ?? BASE;
        return (
          <g key={e.id}>
            <motion.path
              d={path(e.from, e.to)}
              fill="none"
              strokeDasharray={look.dash}
              className={look.walk ? "route" : undefined}
              initial={intro ? { pathLength: 0, opacity: 0.55 } : false}
              animate={{ pathLength: 1, stroke: look.stroke, strokeWidth: look.width, opacity: look.opacity }}
              transition={{ pathLength: { duration: 0.6, delay: intro ? 0.9 + i * 0.22 : 0 }, default: { duration: 0.35 } }}
            />
            {intro && (
              <motion.text
                x={citeAt(e.from, e.to).x}
                y={citeAt(e.from, e.to).y}
                textAnchor={citeAt(e.from, e.to).anchor}
                className="fill-forest font-mono text-[9.5px]"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.4 + i * 0.22 }}
              >
                {e.cite}
              </motion.text>
            )}
          </g>
        );
      })}

      {/* Drift: a new arrow arrives with the push */}
      {mode === "drift" && (
        <>
          <motion.path
            d={`M${node("hooks").x + W / 2} ${node("hooks").y + 4} C 330 330, 420 330, ${node("timeout").x - W / 2} ${node("timeout").y + 6}`}
            fill="none"
            stroke="var(--color-vermilion)"
            strokeWidth="2.4"
            strokeDasharray="6 5"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 0.6, duration: 0.9 }}
          />
          <motion.g initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.4, type: "spring", stiffness: 300, damping: 14 }} style={{ transformOrigin: "350px 312px" }}>
            <rect x="328" y="296" width="44" height="17" rx="3" fill="var(--color-vermilion)" />
            <text x="350" y="308" textAnchor="middle" className="fill-paper-light font-mono text-[9.5px] font-medium">
              NEW
            </text>
          </motion.g>
        </>
      )}

      {/* Flow: a request travels client → core → errors */}
      {mode === "flow" &&
        [0, 1].map((k) => (
          <motion.circle
            key={k}
            r="6"
            fill="var(--color-sea)"
            stroke="var(--color-paper-light)"
            strokeWidth="2"
            initial={{ offsetDistance: "0%" }}
            animate={{ offsetDistance: "100%" }}
            transition={{ duration: 1.1, delay: 0.4 + k * 1.3, repeat: Infinity, repeatDelay: 1.5, ease: "easeInOut" }}
            style={{ offsetPath: `path("${path(k === 0 ? "client" : "core", k === 0 ? "core" : "errors")}")` }}
          />
        ))}

      {nodes.map((n, i) => {
        const look = nl[n.id] ?? {};
        return (
          <motion.g
            key={n.id}
            initial={intro ? { opacity: 0, scale: 0.8 } : false}
            animate={{ opacity: look.dim ? 0.3 : 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 20, delay: intro ? 0.1 + i * 0.1 : 0 }}
            style={{ transformOrigin: `${n.x}px ${n.y}px` }}
          >
            {look.ring === "var(--color-vermilion)" && mode === "blast" && (
              <motion.rect
                x={n.x - W / 2}
                y={n.y - H / 2}
                width={W}
                height={H}
                rx="5"
                fill="none"
                stroke="var(--color-vermilion)"
                initial={{ scale: 1, opacity: 0.7 }}
                animate={{ scale: 1.35, opacity: 0 }}
                transition={{ duration: 1.4, repeat: Infinity }}
                style={{ transformOrigin: `${n.x}px ${n.y}px` }}
              />
            )}
            <rect x={n.x - W / 2} y={n.y - H / 2} width={W} height={H} rx="5" fill="var(--color-paper-light)" stroke={look.ring ?? "var(--color-ink)"} strokeWidth={look.ring ? 2 : 1} />
            <text x={n.x} y={n.y + 4} textAnchor="middle" className="fill-ink font-sans text-[11.5px] font-medium">
              {n.label}
            </text>
            <AnimatePresence>
              {look.badge && (
                <motion.g initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.08 }}>
                  <rect x={n.x + W / 2 - 40} y={n.y - H / 2 - 9} width="44" height="16" rx="3" fill={look.badge.color} />
                  <text x={n.x + W / 2 - 18} y={n.y - H / 2 + 2.5} textAnchor="middle" className="fill-paper-light font-mono text-[9px] font-medium">
                    {look.badge.text}
                  </text>
                </motion.g>
              )}
            </AnimatePresence>
          </motion.g>
        );
      })}
    </svg>
  );
}
