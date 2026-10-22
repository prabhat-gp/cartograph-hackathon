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
  client: { label: "Client", Icon: MonitorSmartphone, tile: "bg-[#5b564b]/12 text-[#5b564b] dark:text-[#b8b0a0]", dot: "bg-[#5b564b] dark:bg-[#b8b0a0]", text: "text-[#5b564b] dark:text-[#b8b0a0]" },
  frontend: { label: "Frontend", Icon: PanelsTopLeft, tile: "bg-[#2c5878]/12 text-[#2c5878] dark:text-[#7fa9cf]", dot: "bg-[#2c5878] dark:bg-[#7fa9cf]", text: "text-[#2c5878] dark:text-[#7fa9cf]" },
  api: { label: "API", Icon: Braces, tile: "bg-[#d9442b]/12 text-[#d9442b] dark:text-[#ff8a70]", dot: "bg-[#d9442b] dark:bg-[#ff8a70]", text: "text-[#d9442b] dark:text-[#ff8a70]" },
  service: { label: "Service", Icon: Boxes, tile: "bg-[#7a4e8a]/12 text-[#7a4e8a] dark:text-[#c79bd6]", dot: "bg-[#7a4e8a] dark:bg-[#c79bd6]", text: "text-[#7a4e8a] dark:text-[#c79bd6]" },
  worker: { label: "Worker", Icon: Cog, tile: "bg-[#b07a1e]/12 text-[#b07a1e] dark:text-[#e0a84a]", dot: "bg-[#b07a1e] dark:bg-[#e0a84a]", text: "text-[#b07a1e] dark:text-[#e0a84a]" },
  database: { label: "Database", Icon: Database, tile: "bg-[#2f5d46]/12 text-[#2f5d46] dark:text-[#6fb38d]", dot: "bg-[#2f5d46] dark:bg-[#6fb38d]", text: "text-[#2f5d46] dark:text-[#6fb38d]" },
  cache: { label: "Cache", Icon: Zap, tile: "bg-[#b5321d]/12 text-[#b5321d] dark:text-[#ff6a4d]", dot: "bg-[#b5321d] dark:bg-[#ff6a4d]", text: "text-[#b5321d] dark:text-[#ff6a4d]" },
  queue: { label: "Queue", Icon: Layers, tile: "bg-[#8a5a2b]/12 text-[#8a5a2b] dark:text-[#d6a473]", dot: "bg-[#8a5a2b] dark:bg-[#d6a473]", text: "text-[#8a5a2b] dark:text-[#d6a473]" },
  storage: { label: "Storage", Icon: HardDrive, tile: "bg-[#2c6e6e]/12 text-[#2c6e6e] dark:text-[#7cc2c2]", dot: "bg-[#2c6e6e] dark:bg-[#7cc2c2]", text: "text-[#2c6e6e] dark:text-[#7cc2c2]" },
  external: { label: "Third party", Icon: Globe, tile: "bg-[#6f6858]/12 text-[#6f6858] dark:text-[#a39a88]", dot: "bg-[#6f6858] dark:bg-[#a39a88]", text: "text-[#6f6858] dark:text-[#a39a88]" },
};

export function kindMeta(kind: NodeKind): KindMeta {
  return KINDS[kind] ?? KINDS.service;
}
