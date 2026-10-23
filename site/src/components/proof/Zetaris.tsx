"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import { EXPRESS_EXPLAINED_PCT, KY_EXPLAINED_PCT } from "@/lib/site";

const SEA = "var(--color-sea-light)";

// The provenance USL (sql/zetaris/provenance_usl.sql): nine tables and their keys.
const tables = [
  { id: "repository", x: 4, y: 8, cols: ["id", "head_sha"] },
  { id: "source_file", x: 36, y: 8, cols: ["id", "repo_id →", "path"] },
  { id: "line_origin", x: 68, y: 8, cols: ["file_id →", "line_start", "commit_sha →"] },
  { id: "code_change", x: 68, y: 52, cols: ["sha", "subject", "pr_id →"] },
  { id: "file_change", x: 36, y: 52, cols: ["commit_sha →", "file_id"] },
  { id: "pull_request", x: 68, y: 86, cols: ["id", "title", "issue_count"] },
  { id: "pr_issue", x: 36, y: 90, cols: ["pr_id →", "issue_id →"] },
  { id: "issue", x: 4, y: 90, cols: ["id", "title"] },
  { id: "discussion", x: 4, y: 52, cols: ["parent_id →", "author"] },
];
const links: [string, string][] = [
  ["repository", "source_file"],
  ["source_file", "line_origin"],
  ["line_origin", "code_change"],
  ["code_change", "file_change"],
  ["code_change", "pull_request"],
  ["pull_request", "pr_issue"],
  ["pr_issue", "issue"],
  ["pull_request", "discussion"],
];
const T = (id: string) => tables.find((t) => t.id === id)!;

export function UslTables() {
  return (
    <div className="relative h-full p-5">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {links.map(([a, b], i) => {
          const p = T(a);
          const q = T(b);
          return (
            <motion.line
              key={a + b}
              x1={p.x + 13.5}
              y1={p.y * 0.8 + 7}
              x2={q.x + 13.5}
              y2={q.y * 0.8 + 7}
              stroke={SEA}
              strokeWidth="0.35"
              strokeDasharray="1.2 1"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.8 }}
              transition={{ delay: 1.2 + i * 0.15, duration: 0.5 }}
            />
          );
        })}
      </svg>
      {tables.map((t, i) => (
        <motion.div
          key={t.id}
          initial={{ opacity: 0, y: 12, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.1 + i * 0.1, type: "spring", stiffness: 260, damping: 20 }}
          whileHover={{ y: -3, borderColor: SEA }}
          className="absolute w-[27%] overflow-hidden rounded-[4px] border border-paper/25 bg-[#1b1915] font-mono text-[10.5px]"
          style={{ left: `${t.x}%`, top: `${t.y * 0.8}%` }}
        >
          <p className="px-2 py-1 font-medium text-paper-light" style={{ background: "rgba(44,88,120,0.6)" }}>
            {t.id}
          </p>
          {t.cols.map((c) => (
            <p key={c} className={`px-2 py-0.5 ${c.endsWith("→") ? "text-ochre-light" : "text-paper/60"}`}>
              {c}
            </p>
          ))}
        </motion.div>
      ))}
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.6 }} className="absolute right-5 bottom-4 font-mono text-[10.5px] text-paper/50">
        lightning.metastore.cartograph.provenance
      </motion.p>
    </div>
  );
}

const SQL = [
  ["SELECT", " lo.line_start, c.sha, c.subject, c.pr_id"],
  ["FROM", "   provenance.line_origin lo"],
  ["JOIN", "   provenance.code_change c ON c.sha = lo.commit_sha"],
  ["WHERE", "  lo.file_id = 'sindresorhus/ky:source/core/constants.ts'"],
  ["  AND", "  263 BETWEEN lo.line_start AND lo.line_end"],
];

export function UslQuery() {
  const full = SQL.map(([k, r]) => k + r).join("\n");
  const [n, setN] = useState(0);
  useEffect(() => {
    const c = animate(0, full.length, { duration: 1.8, ease: "linear", onUpdate: (v) => setN(Math.round(v)) });
    return () => c.stop();
  }, [full.length]);
  let left = n;
  return (
    <div className="flex h-full flex-col p-6">
      <pre className="min-h-[9.5em] font-mono text-[12.5px] leading-relaxed text-paper/85">
        {SQL.map(([k, r], i) => {
          const kShown = k.slice(0, Math.max(0, left));
          left -= k.length;
          const rShown = r.slice(0, Math.max(0, left));
          left -= r.length + 1;
          return (
            <span key={i} className="block">
              <span className="text-ochre-light">{kShown}</span>
              {rShown.includes("'") ? (
                <>
                  {rShown.split("'")[0]}
                  <span className="text-[#f08a73]">&apos;{rShown.split("'").slice(1).join("'")}</span>
                </>
              ) : (
                rShown
              )}
            </span>
          );
        })}
      </pre>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.1 }} className="mt-4 overflow-hidden rounded-[4px] border border-paper/15 font-mono text-[11.5px]">
        <div className="grid grid-cols-[50px_90px_1fr_50px] gap-3 bg-paper/5 px-3 py-1.5 text-paper/45">
          <span>line</span>
          <span>commit</span>
          <span>subject</span>
          <span>PR</span>
        </div>
        <motion.div initial={{ backgroundColor: "rgba(134,180,214,0.35)" }} animate={{ backgroundColor: "rgba(134,180,214,0)" }} transition={{ delay: 2.4, duration: 1.4 }} className="grid grid-cols-[50px_90px_1fr_50px] gap-3 px-3 py-2 text-paper/85">
          <span>263</span>
          <span>68a5228840</span>
          <span className="truncate">Add `ky.retry()` to force retries…</span>
          <span className="text-ochre-light">#779</span>
        </motion.div>
      </motion.div>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.9 }} className="mt-auto font-mono text-[11px] text-paper/50">
        one join: from a line of code to the pull request behind it
      </motion.p>
    </div>
  );
}

export function UslQuality() {
  const v = useMotionValue(0);
  const shown = useTransform(v, (x) => Math.round(x));
  const width = useTransform(v, (x) => `${x}%`);
  useEffect(() => {
    const c = animate(v, EXPRESS_EXPLAINED_PCT, { duration: 1.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [v]);
  return (
    <div className="flex h-full flex-col justify-center px-10">
      <p className="font-mono text-[11px] tracking-[0.16em] text-paper/50 uppercase">Data-quality rule · states_a_reason</p>
      <p className="mt-3 font-serif text-[7rem] leading-[0.85] text-paper-light">
        <motion.span>{shown}</motion.span>
        <span className="text-[0.45em] text-[#f08a73]">%</span>
      </p>
      <div className="mt-5 h-3 w-full overflow-hidden rounded-full border border-paper/30">
        <motion.div style={{ width, background: "var(--color-vermilion)" }} className="h-full" />
      </div>
      <p className="mt-4 max-w-md text-[15px] text-paper/75">of traced express lines lead to a pull request that states its reason.</p>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.6 }} className="mt-6 flex flex-wrap gap-2 font-mono text-[11px]">
        <span className="rounded-full border border-paper/20 px-3 py-1 text-paper/70">ky: {KY_EXPLAINED_PCT}% of map arrows</span>
        <span className="rounded-full border border-paper/20 px-3 py-1 text-paper/70">issue_count &gt; 0 OR length(body) ≥ 120</span>
      </motion.div>
    </div>
  );
}
