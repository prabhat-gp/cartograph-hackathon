"use client";

import { motion } from "motion/react";
import { CODE } from "@/lib/site";
import { Chapter, type ChapterProps } from "./Chapter";
import { MemoryForget, MemoryRecall, MemorySave, RuntimeConnect, RuntimeRoute } from "./proof/Meterless";
import { NvidiaCrew, NvidiaGuard, NvidiaUsage } from "./proof/Nvidia";
import { UslQuality, UslQuery, UslTables } from "./proof/Zetaris";

const chapters: Omit<ChapterProps, "index" | "total">[] = [
  {
    id: "zetaris",
    sponsor: "Zetaris",
    accent: "var(--color-sea-light)",
    requirement: "Build a USL · query it · add a DQ rule",
    line: "Every line, commit, pull request and issue in one semantic layer.",
    frames: [
      { caption: "1 · Nine tables, one provenance layer", view: () => <UslTables /> },
      { caption: "2 · One query from a line to its reason", view: () => <UslQuery /> },
      { caption: "3 · A rule that scores explainability", view: () => <UslQuality /> },
    ],
    links: [
      { label: "USL definition", href: CODE("sql/zetaris/provenance_usl.sql") },
      { label: "DQ rules", href: CODE("sql/zetaris/dq_rules.sql") },
      { label: "Live queries", href: CODE("src/agent/evidence.ts") },
    ],
  },
  {
    id: "hmem",
    sponsor: "Meterless H-MEM",
    accent: "var(--color-ochre-light)",
    requirement: "An engine in a working feature",
    line: "Cartograph's memory: it keeps approved answers, and knows when they go stale.",
    frames: [
      { caption: "1 · An approved answer becomes a memory", view: () => <MemorySave /> },
      { caption: "2 · The next question starts from it", view: () => <MemoryRecall /> },
      { caption: "3 · Code changes, the memory is set aside", view: () => <MemoryForget /> },
    ],
    links: [
      { label: "H-MEM engine", href: CODE("src/memory/hmem.ts") },
      { label: "Used by the agents", href: CODE("src/memory/findings.ts") },
      { label: "Conformance suite", href: CODE("third_party/meterless-hmem-conformance") },
    ],
  },
  {
    id: "runtime",
    sponsor: "Meterless Runtime",
    accent: "var(--color-ochre-light)",
    requirement: "Primary AI provider",
    line: "Paste Nightshift's connect link and every agent runs through it. Without it, NVIDIA answers directly.",
    frames: [
      { caption: "1 · One paste connects it", view: () => <RuntimeConnect /> },
      { caption: "2 · Agent → Nightshift → Nemotron", view: () => <RuntimeRoute /> },
      { caption: "3 · Runtime offline, NVIDIA steps in", view: () => <RuntimeRoute offline /> },
    ],
    links: [
      { label: "Runtime provider", href: CODE("src/meterless/runtime.ts") },
      { label: "Desk settings", href: CODE("src/meterless/settings.ts") },
      { label: "Provider choice", href: CODE("src/config.ts") },
      { label: "Model client", href: CODE("src/llm/client.ts") },
    ],
  },
  {
    id: "nvidia",
    sponsor: "NVIDIA Nemotron",
    accent: "var(--color-forest-light)",
    requirement: "Nemotron in every agent",
    line: "Ultra plans and judges. Lightning reads and writes. Every call is checked.",
    frames: [
      { caption: "1 · Every agent, its model", view: () => <NvidiaCrew /> },
      { caption: "2 · Two tiers, every call logged", view: () => <NvidiaUsage /> },
      { caption: "3 · Output is validated, never trusted", view: () => <NvidiaGuard /> },
    ],
    links: [
      { label: "Model client", href: CODE("src/llm/client.ts") },
      { label: "Usage ledger", href: CODE("src/llm/usage.ts") },
      { label: "Agents", href: CODE("src/agent/agents.ts") },
    ],
  },
];

export function Sponsors() {
  return (
    <div id="proof" className="relative bg-ink text-paper">
      <div className="mx-auto max-w-7xl px-4 pt-28 pb-6 sm:px-6">
        <motion.p initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="font-mono text-[11px] tracking-[0.22em] text-[#f08a73] uppercase">
          The proof
        </motion.p>
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="mt-4 max-w-3xl font-serif text-[3.4rem] leading-[0.95] text-paper-light sm:text-[4.4rem]"
        >
          Built on Zetaris, Meterless and NVIDIA.
        </motion.h2>
      </div>
      {chapters.map((c, i) => (
        <Chapter key={c.id} {...c} index={i} total={chapters.length} />
      ))}
    </div>
  );
}
