// "Powered by": which AI provider, models, data layer and memory engine this
// server is running on right now, checked live.
import { Cpu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ToolResult } from "./bridge";
import { IconButton, Spinner, cn } from "./ui";

interface SponsorStatus {
  sponsor: string;
  role: string;
  status: "ok" | "standby" | "todo" | "fail";
  detail: string;
}

const DOT: Record<SponsorStatus["status"], string> = { ok: "bg-ok", standby: "bg-warn", todo: "bg-faint", fail: "bg-danger" };
const WORD: Record<SponsorStatus["status"], string> = { ok: "Working", standby: "Standing by", todo: "Not set up", fail: "Not reachable" };

export function PoweredBy({ callTool }: { callTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult> }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SponsorStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const call = useRef(callTool);
  call.current = callTool;

  useEffect(() => {
    if (!open) return;
    setError(null);
    void call.current("cartograph_status", {}).then((r) => {
      if (r.isError) setError(r.text ?? "Couldn't check the integrations");
      else setRows((r.structuredContent as { sponsors: SponsorStatus[] }).sponsors);
    });
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    addEventListener("mousedown", onDown);
    return () => removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <IconButton label="Powered by" data-tour="powered" onClick={() => setOpen((o) => !o)} className={cn(open && "bg-surface-2 text-text")}>
        <Cpu size={15} />
      </IconButton>
      {open && (
        <div className="absolute top-10 right-0 z-50 w-[340px] max-w-[calc(100vw-24px)] rounded-[4px] border border-text bg-surface p-4 shadow-pop">
          <div className="mb-3 flex items-center justify-between">
            <p className="m-0 font-serif text-[21px] leading-tight text-text">Powered by</p>
            <IconButton label="Close" onClick={() => setOpen(false)} className="-mr-2 size-6">
              <X size={13} />
            </IconButton>
          </div>
          {error && <p className="m-0 text-[12.5px] text-danger">{error}</p>}
          {!rows && !error && (
            <span className="flex items-center gap-2 text-[12.5px] text-muted">
              <Spinner size={12} /> Checking each integration…
            </span>
          )}
          {rows && (
            <ul className="m-0 grid list-none gap-3 p-0">
              {rows.map((r) => (
                <li key={r.sponsor} className="grid gap-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-text">{r.sponsor}</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-muted">
                      <span className={cn("size-2 rounded-full", DOT[r.status])} /> {WORD[r.status]}
                    </span>
                  </div>
                  <span className="font-mono text-[10.5px] tracking-[0.08em] text-faint uppercase">{r.role}</span>
                  <span className="text-[12px] leading-snug text-muted">{r.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
