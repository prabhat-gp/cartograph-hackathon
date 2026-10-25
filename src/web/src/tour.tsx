// A first-run tour of the desk. Steps are built from whatever map is open, so
// the tour points at that repo's real parts and arrows, and steps the map
// can't show (no flows, no history) are left out.
import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";
import type { CartographGraph } from "../../shared/graph";
import { blastRadius } from "../../server/graph/analysis";
import { Button, IconButton } from "./ui";

export type TourAction =
  | { kind: "reset" }
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | { kind: "tab"; tab: "overview" | "flows" | "drift" };

export interface TourStep {
  /** CSS selector of the element to spotlight; the bubble centres when it isn't on screen. */
  target: string;
  title: string;
  body: string;
  /** Puts the desk in the state this step talks about. */
  action: TourAction;
}

const TOUR_KEY = "cartograph.tour.done";

export function tourDone(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === "1";
  } catch {
    return false;
  }
}

function markTourDone(): void {
  try {
    localStorage.setItem(TOUR_KEY, "1");
  } catch {
    /* private mode: the offer just comes back next time */
  }
}

const node = (id: string) => `.react-flow__node[data-id="${CSS.escape(id)}"]`;
const edge = (id: string) => `.react-flow__edge[data-id="${CSS.escape(id)}"]`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function buildTourSteps(graph: CartographGraph, driftReviews: number): TourStep[] {
  const degree = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const busiest = [...graph.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))[0];
  const arrow = busiest && graph.edges.find((e) => (e.from === busiest.id || e.to === busiest.id) && e.evidence.length);
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const mostDepended = [...graph.nodes]
    .map((n) => ({ n, impacted: blastRadius(graph, n.id)?.impacted.length ?? 0 }))
    .sort((a, b) => b.impacted - a.impacted)[0];

  const steps: TourStep[] = [
    {
      target: '[data-tour="map"]',
      title: `This is ${graph.repo.name}`,
      body: `AI agents read the code and drew it as ${plural(graph.nodes.length, "part")} and ${plural(graph.edges.length, "connection")}. Drag to move around, scroll to zoom.`,
      action: { kind: "reset" },
    },
  ];
  if (busiest) {
    steps.push({
      target: node(busiest.id),
      title: "Each part of the code is a box",
      body: `${busiest.label}${busiest.tech ? ` (${busiest.tech})` : ""} is the most connected part here. Click any box to see its files and what it talks to.`,
      action: { kind: "node", id: busiest.id },
    });
  }
  if (arrow) {
    const cite = arrow.evidence[0];
    steps.push(
      {
        target: edge(arrow.id),
        title: "An arrow means one part uses another",
        body: `${label(arrow.from)} uses ${label(arrow.to)}. Every arrow links to the line of code that proves it, here ${cite.path.split("/").pop()} line ${cite.line}.`,
        action: { kind: "edge", id: arrow.id },
      },
      {
        target: '[data-tour="why"]',
        title: "Ask why it was built this way",
        body:
          graph.repo.source === "github"
            ? "Agents follow that line to the commit, pull request and issue behind it, and explain the reason in plain English."
            : "Agents follow that line through the git history and explain the reason. It works best on GitHub repos, where pull requests and issues say why.",
        action: { kind: "edge", id: arrow.id },
      },
    );
  }
  if (mostDepended && mostDepended.impacted > 0) {
    steps.push({
      target: '[data-tour="blast"]',
      title: "Before you change something",
      body: `Open a part and see everything that breaks if it goes down. If ${mostDepended.n.label} fails, ${plural(mostDepended.impacted, "part")} ${mostDepended.impacted === 1 ? "is" : "are"} affected.`,
      action: { kind: "node", id: mostDepended.n.id },
    });
  }
  if (graph.flows.length) {
    steps.push({
      target: '[data-tour="tab-flows"]',
      title: "Follow a request end to end",
      body: `Flows play one journey through the code, step by step, like "${graph.flows[0].name}". This map has ${plural(graph.flows.length, "flow")}.`,
      action: { kind: "tab", tab: "flows" },
    });
  }
  steps.push({
    target: '[data-tour="tab-drift"]',
    title: "The map stays up to date",
    body: driftReviews
      ? `Cartograph re-checks the map on every push and shows what changed. It has reviewed ${plural(driftReviews, "push")} here so far.`
      : "Cartograph re-checks the map on every push and shows what changed here.",
    action: { kind: "reset" },
  });
  steps.push({
    target: '[data-tour="replay"]',
    title: "That's it",
    body: "Start by clicking an arrow you don't understand. You can replay this tour here any time.",
    action: { kind: "reset" },
  });
  return steps;
}

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;
const BUBBLE_W = 300;

/** Where the target is right now; it can move as panels open and the map pans. */
function useTargetRect(selector: string): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = document.querySelector(selector);
      const r = el?.getBoundingClientRect();
      const visible = r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      setRect((prev) => {
        if (!visible) return prev === null ? prev : null;
        const next = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
        return prev && Math.abs(prev.top - next.top) < 1 && Math.abs(prev.left - next.left) < 1 && Math.abs(prev.width - next.width) < 1 ? prev : next;
      });
    };
    measure();
    const t = setInterval(measure, 150);
    return () => clearInterval(t);
  }, [selector]);
  return rect;
}

function bubblePosition(rect: Rect | null, height: number): { top: number; left: number } {
  const w = Math.min(BUBBLE_W, innerWidth - 32);
  if (!rect) return { top: innerHeight / 2 - height / 2, left: innerWidth / 2 - w / 2 };
  const clampTop = (t: number) => Math.max(16, Math.min(t, innerHeight - height - 16));
  const clampLeft = (l: number) => Math.max(16, Math.min(l, innerWidth - w - 16));
  if (rect.left + rect.width + 12 + w < innerWidth - 16) return { top: clampTop(rect.top), left: rect.left + rect.width + 12 };
  if (rect.left - 12 - w > 16) return { top: clampTop(rect.top), left: rect.left - 12 - w };
  if (rect.top + rect.height + 12 + height < innerHeight - 16) return { top: rect.top + rect.height + 12, left: clampLeft(rect.left) };
  return { top: clampTop(rect.top - 12 - height), left: clampLeft(rect.left) };
}

export function Tour({ steps, onAction, onClose }: { steps: TourStep[]; onAction: (a: TourAction) => void; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const step = steps[Math.min(index, steps.length - 1)];
  const rect = useTargetRect(step.target);
  const [bubble, setBubble] = useState<HTMLDivElement | null>(null);
  const pos = bubblePosition(rect, bubble?.offsetHeight ?? 180);
  const last = index >= steps.length - 1;

  useEffect(() => {
    onAction(step.action);
  }, [step, onAction]);

  const close = () => {
    markTourDone();
    onAction({ kind: "reset" });
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-label="Cartograph tour">
      {/* The spotlight: a hole in a dimmed screen. Clicks are caught so the tour stays in step. */}
      <div
        className="pointer-events-none absolute rounded-[6px] ring-2 ring-accent transition-all duration-300"
        style={rect ? { ...rect, boxShadow: "0 0 0 9999px rgb(20 18 14 / 0.55)" } : { top: "50%", left: "50%", width: 0, height: 0, boxShadow: "0 0 0 9999px rgb(20 18 14 / 0.55)" }}
      />
      <div
        ref={setBubble}
        className="absolute rounded-[4px] border border-text bg-surface p-4 shadow-pop transition-[top,left] duration-300"
        style={{ ...pos, width: Math.min(BUBBLE_W, innerWidth - 32) }}
      >
        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-mono text-[10.5px] tracking-[0.16em] text-muted uppercase">
            {index + 1} of {steps.length}
          </span>
          <IconButton label="Close the tour" onClick={close} className="-mr-2 size-6">
            <X size={13} />
          </IconButton>
        </div>
        <p className="m-0 font-serif text-[21px] leading-tight text-text">{step.title}</p>
        <p className="mt-1.5 mb-0 text-[13px] leading-relaxed break-words text-muted">{step.body}</p>
        <div className="mt-3.5 flex items-center justify-between">
          <Button size="sm" variant="ghost" onClick={close}>
            Skip
          </Button>
          <div className="flex gap-1.5">
            {index > 0 && (
              <Button size="sm" onClick={() => setIndex(index - 1)}>
                Back
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={() => (last ? close() : setIndex(index + 1))}>
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The quiet offer shown on a first map; the tour itself starts only when asked. */
export function TourOffer({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return (
    <div className="absolute top-3.5 right-3.5 z-30 w-[260px] rounded-[4px] border border-text bg-surface p-3.5 shadow-pop max-sm:hidden">
      <p className="m-0 font-serif text-[19px] leading-tight text-text">New to Cartograph?</p>
      <p className="mt-1 mb-0 text-[12.5px] leading-relaxed text-muted">A one-minute tour of this map: parts, arrows, why, and what breaks.</p>
      <div className="mt-3 flex justify-end gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            markTourDone();
            onDismiss();
          }}
        >
          Not now
        </Button>
        <Button size="sm" variant="primary" onClick={onStart}>
          Take the tour
        </Button>
      </div>
    </div>
  );
}
