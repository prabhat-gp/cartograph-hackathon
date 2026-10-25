// "Powered by": which AI provider, models, data layer and memory engine this
// server is running on right now, checked live.
import { Cpu, Eye, EyeOff, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { ToolResult } from "./bridge";
import { Button, IconButton, Spinner, cn } from "./ui";

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

  const check = useCallback(() => {
    setError(null);
    void call.current("cartograph_status", {}).then((r) => {
      if (r.isError) setError(r.text ?? "Couldn't check the integrations");
      else setRows((r.structuredContent as { sponsors: SponsorStatus[] }).sponsors);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    check();
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    addEventListener("mousedown", onDown);
    return () => removeEventListener("mousedown", onDown);
  }, [open, check]);

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
                  {r.sponsor === "Meterless Nightshift" && <NightshiftSettings onChange={check} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

interface Settings {
  baseUrl: string;
  token: string | null;
}

interface Health {
  state: "online" | "unauthorized" | "offline";
  baseUrl: string;
  modes: string[];
  reason: string;
}

type Note = { tone: "ok" | "warn"; text: string };

function describe(health: Health | null): Note {
  if (!health) return { tone: "warn", text: "No runtime on ports 8088, 8090, 8787 or 11434. Start Nightshift on this computer, then try again." };
  if (health.state === "online") return { tone: "ok", text: `Connected at ${health.baseUrl}: ${health.modes.length} modes. Every agent now runs on Nightshift.` };
  if (health.state === "unauthorized") return { tone: "warn", text: `Nightshift at ${health.baseUrl} rejected the token. Paste the runtime's access token from its Console.` };
  return { tone: "warn", text: `Nightshift isn't reachable at ${health.baseUrl}. Start the runtime, then run Auto Detect.` };
}

/**
 * Connect Nightshift from the desk: one field takes a connect link or a base
 * URL. The server only offers this to someone on its own machine, so a public
 * deployment shows the status alone.
 */
function NightshiftSettings({ onChange }: { onChange: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState("");
  const [token, setToken] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  useEffect(() => {
    if (window.parent !== window && !window.__CARTOGRAPH_STANDALONE__) return;
    fetch("api/meterless")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { settings: Settings } | null) => body && setSettings(body.settings))
      .catch(() => undefined);
  }, []);

  if (!settings) return null;

  const send = async (method: "POST" | "DELETE", path: string, body?: object) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`api/meterless${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const out = (await res.json()) as { settings?: Settings; health?: Health | null; error?: string };
      if (!res.ok) return setNote({ tone: "warn", text: out.error ?? "Couldn't save the settings" });
      setSettings(out.settings ?? settings);
      if (method === "DELETE") setNote({ tone: "ok", text: "Disconnected. The agents call NVIDIA directly." });
      else setNote(describe(out.health ?? null));
      if (out.health?.state === "online" || method === "DELETE") {
        setToken("");
        setAddress("");
        onChange();
      }
    } catch {
      setNote({ tone: "warn", text: "Couldn't reach the Cartograph server" });
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send("POST", "", { address, token });
  };

  return (
    <div className="mt-1.5 grid gap-2">
      {!editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setEditing(true)}>
            {settings.token ? "Change Nightshift" : "Connect Nightshift"}
          </Button>
          {settings.token && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void send("DELETE", "")}>
              Disconnect
            </Button>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-2 rounded-[4px] border border-line bg-surface-2 p-2.5">
          <label className="grid gap-1 text-[11px] text-muted">
            Connect link or base URL
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={settings.baseUrl}
              spellCheck={false}
              autoComplete="off"
              className="h-8 rounded-[4px] border border-line bg-surface px-2 font-mono text-[11.5px] text-text outline-none placeholder:text-faint focus:border-text"
            />
          </label>
          {!address.includes("/connect") && (
            <label className="grid gap-1 text-[11px] text-muted">
              Access token{settings.token ? ` (saved: ${settings.token})` : ""}
              <span className="flex h-8 items-center rounded-[4px] border border-line bg-surface focus-within:border-text">
                <input
                  type={reveal ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="From Nightshift's Console"
                  spellCheck={false}
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent px-2 font-mono text-[11.5px] text-text outline-none placeholder:text-faint"
                />
                <IconButton type="button" label={reveal ? "Hide" : "Reveal"} onClick={() => setReveal((r) => !r)} className="size-7">
                  {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
                </IconButton>
              </span>
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" type="submit" disabled={busy}>
              {busy && <Spinner size={12} />} Connect
            </Button>
            <Button size="sm" type="button" disabled={busy} onClick={() => void send("POST", "/detect", { token })}>
              Auto Detect
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          <p className="m-0 text-[11px] leading-snug text-faint">Nightshift has to run on the computer that runs Cartograph. The token stays on this computer.</p>
        </form>
      )}
      {note && <p className={cn("m-0 text-[11.5px] leading-snug", note.tone === "ok" ? "text-ok" : "text-warn")}>{note.text}</p>}
    </div>
  );
}
