import { ArrowUpRight, Check } from "lucide-react";
import { WHY_RUN } from "@/lib/site";

// Plate A: expressjs/express drawn as terrain. Modules are places, dependencies
// are roads, and the one being explained is a surveyed route in vermilion.
const places = [
  { id: "app", x: 300, y: 70, label: "application", sub: "lib/application.js" },
  { id: "router", x: 110, y: 170, label: "router", sub: "router" },
  { id: "req", x: 280, y: 205, label: "request", sub: "lib/request.js" },
  { id: "res", x: 455, y: 170, label: "response", sub: "lib/response.js", here: true },
  { id: "send", x: 380, y: 300, label: "send", sub: "npm · send" },
  { id: "browser", x: 560, y: 300, label: "browser", sub: "http client" },
];
const at = (id: string) => places.find((p) => p.id === id)!;
const roads: [string, string][] = [["app", "router"], ["app", "req"], ["app", "res"], ["res", "send"]];
const road = (a: string, b: string) => {
  const p = at(a);
  const q = at(b);
  const mx = (p.x + q.x) / 2;
  return `M${p.x} ${p.y} Q ${mx} ${(p.y + q.y) / 2 - 30} ${q.x} ${q.y}`;
};

// Hand-placed contour rings around two "hills" of the codebase.
const contours = [
  "M60 120 C 120 60, 260 40, 360 60 S 560 110, 620 80",
  "M40 160 C 130 95, 260 80, 370 100 S 560 150, 640 120",
  "M30 210 C 140 140, 270 130, 380 150 S 570 195, 650 165",
  "M50 260 C 150 205, 290 190, 400 205 S 580 245, 650 225",
  "M70 320 C 170 270, 300 255, 420 265 S 590 300, 650 285",
  "M120 360 C 220 325, 330 315, 440 322 S 600 350, 650 340",
];

const ticks = [0, 1, 2, 3, 4];

export function HeroMap() {
  return (
    <figure className="relative border border-ink bg-paper-light shadow-[8px_8px_0_0_var(--color-paper-deep)]">
      {/* Corner registration marks */}
      {["-top-1.5 -left-1.5", "-top-1.5 -right-1.5", "-bottom-1.5 -left-1.5", "-right-1.5 -bottom-1.5"].map((c) => (
        <span key={c} className={`absolute ${c} size-3 border border-ink bg-paper`} />
      ))}

      <div className="flex items-center justify-between border-b border-ink px-4 py-2 font-mono text-[10.5px] tracking-[0.18em] text-ink-soft uppercase">
        <span>Plate A · expressjs/express</span>
        <span className="hidden sm:inline">Illustrated · real answer, 22 Oct</span>
      </div>

      <div className="survey-grid relative">
        <svg viewBox="0 0 680 370" className="block w-full" role="img" aria-label="Express modules as a map, with the route from response to browser highlighted">
          {contours.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="var(--color-forest)" strokeOpacity={0.16 + (i % 2) * 0.06} strokeWidth="1.1" />
          ))}
          {roads.map(([a, b]) => (
            <path key={a + b} d={road(a, b)} fill="none" stroke="var(--color-ink)" strokeOpacity="0.55" strokeWidth="1.4" />
          ))}
          <path d={road("res", "browser")} fill="none" stroke="var(--color-vermilion)" strokeWidth="3" className="route" />

          {places.map((p) => (
            <g key={p.id}>
              {p.here ? (
                <>
                  <circle cx={p.x} cy={p.y} r="15" fill="var(--color-vermilion)" fillOpacity="0.15" />
                  <circle cx={p.x} cy={p.y} r="6.5" fill="var(--color-vermilion)" stroke="var(--color-paper-light)" strokeWidth="2" />
                </>
              ) : (
                <rect x={p.x - 5} y={p.y - 5} width="10" height="10" fill="var(--color-paper-light)" stroke="var(--color-ink)" strokeWidth="1.6" />
              )}
              <text x={p.x + 12} y={p.y - 6} fontFamily="var(--font-plex-mono)" fontSize="12" fontWeight="500" fill="var(--color-ink)" letterSpacing="0.06em">
                {p.label.toUpperCase()}
              </text>
              <text x={p.x + 12} y={p.y + 9} fontFamily="var(--font-plex-mono)" fontSize="9.5" fill="var(--color-ink-soft)">
                {p.sub}
              </text>
            </g>
          ))}

          {/* North arrow */}
          <g transform="translate(630 52)">
            <path d="M0 -18 L6 6 L0 1 L-6 6 Z" fill="var(--color-ink)" />
            <text x="0" y="20" textAnchor="middle" fontFamily="var(--font-plex-mono)" fontSize="10" fill="var(--color-ink)">N</text>
          </g>
          {/* Scale bar */}
          <g transform="translate(30 345)" fontFamily="var(--font-plex-mono)" fontSize="9" fill="var(--color-ink-soft)">
            {ticks.map((t) => (
              <rect key={t} x={t * 22} y="0" width="22" height="5" fill={t % 2 ? "var(--color-paper-light)" : "var(--color-ink)"} stroke="var(--color-ink)" strokeWidth="0.8" />
            ))}
            <text x="0" y="17">0</text>
            <text x="110" y="17" textAnchor="end">5 commits</text>
          </g>
        </svg>
      </div>

      {/* The legend: the route as stops, and the answer that came back. */}
      <figcaption className="grid border-t border-ink md:grid-cols-[1fr_1.15fr]">
        <ol className="border-b border-ink p-4 md:border-r md:border-b-0">
          <li className="mb-3 font-mono text-[10.5px] tracking-[0.18em] text-ink-soft uppercase">Route surveyed</li>
          {WHY_RUN.chain.map((stop, i) => (
            <li key={stop.ref} className="relative flex items-center gap-3 py-1.5 pl-1">
              {i < WHY_RUN.chain.length - 1 && <span className="absolute top-5 left-[11px] h-6 border-l-2 border-dashed border-vermilion/60" />}
              <span className="z-10 grid size-5 shrink-0 place-items-center rounded-full border-2 border-vermilion bg-paper-light font-mono text-[9px] font-medium text-vermilion">
                {i + 1}
              </span>
              <a href={stop.url} target="_blank" rel="noreferrer" className="group flex flex-1 items-baseline justify-between gap-2 text-sm">
                <span className="text-ink-soft">{stop.kind}</span>
                <span className="font-mono text-[12.5px] text-ink underline decoration-rule underline-offset-4 group-hover:decoration-vermilion">
                  {stop.ref}
                </span>
              </a>
            </li>
          ))}
        </ol>
        <div className="p-4">
          <p className="font-mono text-[10.5px] tracking-[0.18em] text-ink-soft uppercase">Why it exists</p>
          <p className="mt-2 font-serif text-[1.35rem] leading-snug text-ink italic">“{WHY_RUN.answer}”</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-ink-soft">
            <span className="flex items-center gap-1.5 text-forest">
              <Check className="size-3.5" /> Critic approved · high confidence
            </span>
            <a href={WHY_RUN.chain[2].url} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 hover:text-vermilion">
              answered in {WHY_RUN.seconds} s <ArrowUpRight className="size-3" />
            </a>
          </div>
        </div>
      </figcaption>
    </figure>
  );
}
