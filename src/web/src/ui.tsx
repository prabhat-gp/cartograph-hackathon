// Small UI primitives shared by every view.
import { clsx } from "clsx";
import { CircleCheck, FileCode2, Info, LoaderCircle, OctagonAlert, Sparkles, TriangleAlert } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Evidence, NodeKind } from "../../shared/graph";
import { kindMeta } from "./kinds";

export const cn = clsx;

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({ variant = "secondary", size = "md", className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 select-none active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-9 px-3.5 text-[13px]",
        variant === "primary" && "bg-gradient-to-b from-[#6a5cff] to-[#4e3fe6] text-white shadow-[0_1px_2px_rgb(0_0_0/0.15),inset_0_1px_0_rgb(255_255_255/0.18)] hover:brightness-110",
        variant === "secondary" && "border border-line bg-surface text-text shadow-card hover:bg-surface-2",
        variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-text",
        variant === "danger" && "border border-danger/30 bg-danger/[0.06] text-danger hover:bg-danger/[0.1]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({ className, children, label, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cn("grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-35", className)}
    >
      {children}
    </button>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint", className)}>{children}</div>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-line bg-surface shadow-card", className)}>{children}</div>;
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11.5px] text-muted", className)}>{children}</span>;
}

/** Monospace tag for edge kinds (HTTP, SQL, CACHE …). */
export function KindTag({ children }: { children: ReactNode }) {
  return <span className="rounded-[5px] bg-surface-3 px-1.5 py-[1px] font-mono text-[9.5px] font-semibold uppercase tracking-wide text-muted">{children}</span>;
}

export function KindTile({ kind, size = "md" }: { kind: NodeKind; size?: "sm" | "md" | "lg" }) {
  const k = kindMeta(kind);
  const px = size === "sm" ? "size-6 rounded-md" : size === "lg" ? "size-10 rounded-xl" : "size-8 rounded-lg";
  const icon = size === "sm" ? 13 : size === "lg" ? 20 : 16;
  return (
    <span className={cn("grid shrink-0 place-items-center", px, k.tile)}>
      <k.Icon size={icon} strokeWidth={1.8} />
    </span>
  );
}

export function KindChip({ kind }: { kind: NodeKind }) {
  const k = kindMeta(kind);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11.5px] font-medium", k.text)}>
      <span className={cn("size-1.5 rounded-full", k.dot)} />
      {k.label}
    </span>
  );
}

export type SeverityLevel = "critical" | "warning" | "info" | "none";

const SEV: Record<SeverityLevel, { label: string; cls: string; Icon: typeof Info }> = {
  critical: { label: "Critical", cls: "bg-danger/10 text-danger ring-danger/25", Icon: OctagonAlert },
  warning: { label: "Warning", cls: "bg-warn/12 text-warn ring-warn/25", Icon: TriangleAlert },
  info: { label: "Info", cls: "bg-info/10 text-info ring-info/25", Icon: Info },
  none: { label: "No drift", cls: "bg-ok/10 text-ok ring-ok/25", Icon: CircleCheck },
};

export function SeverityBadge({ level, className }: { level: SeverityLevel; className?: string }) {
  const s = SEV[level];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", s.cls, className)}>
      <s.Icon size={12} strokeWidth={2.2} />
      {s.label}
    </span>
  );
}

export function severityColor(level: SeverityLevel): string {
  return level === "critical" ? "bg-danger" : level === "warning" ? "bg-warn" : level === "info" ? "bg-info" : "bg-ok";
}

/** A code citation: file path header + the cited line with its number. */
export function CodeCite({ ev, className }: { ev?: Evidence; className?: string }) {
  if (!ev) return null;
  return (
    <div className={cn("overflow-hidden rounded-lg border border-line bg-code", className)}>
      <div className="flex items-center gap-1.5 border-b border-line bg-surface-2/60 px-2.5 py-1.5 text-[11px] text-muted">
        <FileCode2 size={12} className="shrink-0 text-faint" />
        <span className="truncate font-mono">{ev.path}</span>
        <span className="ml-auto shrink-0 font-mono text-faint">L{ev.line}</span>
      </div>
      <pre className="m-0 flex gap-3 overflow-x-auto px-2.5 py-2 font-mono text-[11.5px] leading-relaxed">
        <span className="select-none text-faint">{ev.line}</span>
        <code className="whitespace-pre-wrap break-words text-text">{ev.snippet}</code>
      </pre>
    </div>
  );
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={cn("animate-spin", className)} />;
}

/** "Ask ChatGPT" call-to-action used at the bottom of panels. */
export function AskButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="group mt-5 flex w-full items-center gap-2 rounded-xl border border-dashed border-accent/35 bg-accent-soft/40 px-3.5 py-2.5 text-left text-[12.5px] font-medium text-accent transition-colors hover:bg-accent-soft"
    >
      <Sparkles size={14} className="shrink-0" />
      <span className="flex-1">{children}</span>
      <span className="text-accent/60 transition-transform group-hover:translate-x-0.5">→</span>
    </button>
  );
}

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
