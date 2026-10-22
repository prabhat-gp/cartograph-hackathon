import { ArrowUpRight, Check } from "lucide-react";
import { WHY_RUN } from "@/lib/site";

// An illustrated map of expressjs/express with one dependency selected and the
// real answer the explain agents gave for it.
const nodes = [
  { id: "app", x: 150, y: 28, label: "application", file: "lib/application.js" },
  { id: "router", x: 30, y: 108, label: "router", file: "router" },
  { id: "req", x: 150, y: 108, label: "request", file: "lib/request.js" },
  { id: "res", x: 270, y: 108, label: "response", file: "lib/response.js", selected: true },
  { id: "send", x: 210, y: 188, label: "send", file: "npm: send" },
  { id: "client", x: 330, y: 188, label: "browser", file: "HTTP client" },
];
const W = 104;
const H = 40;
const center = (id: string) => {
  const n = nodes.find((x) => x.id === id)!;
  return { cx: n.x + W / 2, top: n.y, bottom: n.y + H };
};
const edges: [string, string, boolean?][] = [
  ["app", "router"],
  ["app", "req"],
  ["app", "res"],
  ["res", "send"],
  ["res", "client", true],
];

export function MapPreview() {
  return (
    <div className="relative rounded-2xl border border-white/10 bg-night-900/80 p-5 shadow-2xl shadow-black/40 backdrop-blur">
      <div className="flex items-center justify-between font-mono text-[11px] tracking-wider text-white/45 uppercase">
        <span className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-cited" /> expressjs/express · illustrated map
        </span>
        <span>real answer · 22 Oct</span>
      </div>

      <svg viewBox="0 0 450 236" className="mt-4 w-full" role="img" aria-label="Express modules with the response to browser dependency selected">
        {edges.map(([from, to, live]) => {
          const a = center(from);
          const b = center(to);
          const d = `M${a.cx} ${a.bottom} C ${a.cx} ${a.bottom + 26}, ${b.cx} ${b.top - 26}, ${b.cx} ${b.top}`;
          return (
            <g key={`${from}-${to}`}>
              <path d={d} fill="none" stroke={live ? "#7f8cff" : "rgb(255 255 255 / 0.18)"} strokeWidth={live ? 2.2 : 1.4} className={live ? "trace" : undefined} />
              {live && <circle cx={b.cx} cy={b.top} r="3.5" fill="#7f8cff" />}
            </g>
          );
        })}
        {nodes.map((n) => (
          <g key={n.id}>
            <rect
              x={n.x} y={n.y} width={W} height={H} rx="9"
              fill={n.selected ? "rgb(91 108 255 / 0.18)" : "rgb(255 255 255 / 0.04)"}
              stroke={n.selected ? "#7f8cff" : "rgb(255 255 255 / 0.14)"}
            />
            <text x={n.x + 11} y={n.y + 17} fill="#fff" fontSize="11.5" fontWeight="600">{n.label}</text>
            <text x={n.x + 11} y={n.y + 30} fill="rgb(255 255 255 / 0.45)" fontSize="9" fontFamily="var(--font-geist-mono)">{n.file}</text>
          </g>
        ))}
      </svg>

      <div className="mt-3 rounded-xl border border-brand-400/30 bg-brand-500/10 p-4">
        <p className="text-[13px] font-medium text-white">“{WHY_RUN.question}”</p>
        <p className="mt-2 text-[13px] leading-relaxed text-white/70">{WHY_RUN.answer}</p>
        <ol className="mt-3 flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
          {WHY_RUN.chain.map((step, i) => (
            <li key={step.ref} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-white/30">→</span>}
              <a href={step.url} target="_blank" rel="noreferrer" className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-white/80 transition hover:border-brand-400 hover:text-white">
                <span className="text-white/40">{step.kind} </span>
                {step.ref}
              </a>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex items-center justify-between text-[11px] text-white/50">
          <span className="flex items-center gap-1.5 text-cited">
            <Check className="size-3.5" /> Critic approved · high confidence
          </span>
          <a href={WHY_RUN.chain[2].url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-white">
            {WHY_RUN.seconds}s <ArrowUpRight className="size-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
