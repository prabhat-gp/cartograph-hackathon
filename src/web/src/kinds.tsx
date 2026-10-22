// Visual identity of each component kind: label, icon and colour tokens.
import {
  Boxes,
  Braces,
  Cog,
  Database,
  Globe,
  HardDrive,
  Layers,
  type LucideIcon,
  MonitorSmartphone,
  PanelsTopLeft,
  Zap,
} from "lucide-react";
import type { NodeKind } from "../../shared/graph";

export interface KindMeta {
  label: string;
  Icon: LucideIcon;
  /** Icon tile: tinted background + coloured glyph. */
  tile: string;
  /** Small solid dot / swatch. */
  dot: string;
  /** Text colour for chips. */
  text: string;
}

export const KINDS: Record<NodeKind, KindMeta> = {
  client: { label: "Client", Icon: MonitorSmartphone, tile: "bg-slate-500/10 text-slate-600 dark:text-slate-300", dot: "bg-slate-400", text: "text-slate-600 dark:text-slate-300" },
  frontend: { label: "Frontend", Icon: PanelsTopLeft, tile: "bg-blue-500/10 text-blue-600 dark:text-blue-400", dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-400" },
  api: { label: "API", Icon: Braces, tile: "bg-violet-500/10 text-violet-600 dark:text-violet-400", dot: "bg-violet-500", text: "text-violet-600 dark:text-violet-400" },
  service: { label: "Service", Icon: Boxes, tile: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400", dot: "bg-indigo-500", text: "text-indigo-600 dark:text-indigo-400" },
  worker: { label: "Worker", Icon: Cog, tile: "bg-amber-500/12 text-amber-600 dark:text-amber-400", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  database: { label: "Database", Icon: Database, tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  cache: { label: "Cache", Icon: Zap, tile: "bg-rose-500/10 text-rose-600 dark:text-rose-400", dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" },
  queue: { label: "Queue", Icon: Layers, tile: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400", dot: "bg-fuchsia-500", text: "text-fuchsia-600 dark:text-fuchsia-400" },
  storage: { label: "Storage", Icon: HardDrive, tile: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400", dot: "bg-cyan-500", text: "text-cyan-700 dark:text-cyan-400" },
  external: { label: "Third party", Icon: Globe, tile: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300", dot: "bg-zinc-400", text: "text-zinc-600 dark:text-zinc-300" },
};

export function kindMeta(kind: NodeKind): KindMeta {
  return KINDS[kind] ?? KINDS.service;
}
