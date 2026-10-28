// Top-to-bottom layered layout, the classic architecture diagram: clients on top,
// then frontends, APIs, services, and data stores / third parties at the bottom.
// Edges point actor → dependency, which already reads downwards, except two
// kinds we flip *for layout only* so the picture stays tidy:
//  - consume (worker → queue): workers sit below the queue they drain
//  - webhook (external → api): the third party sits below the API it calls
import dagre from "@dagrejs/dagre";
import type { CartographEdge, CartographNode } from "../../shared/graph";

export const NODE_W = 232;
export const NODE_H = 64;
/** Horizontal gap between components in the same rank. */
const GAP_X = 36;
/** Widest a rank may get before it wraps, and the height of each extra line. */
const MAX_ROW = 6;
const LINE_H = NODE_H + 40;

export interface Positioned {
  x: number;
  y: number;
}

export function layoutGraph(nodes: CartographNode[], edges: CartographEdge[]): Map<string, Positioned> {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "TB", nodesep: 34, ranksep: 58, edgesep: 16, marginx: 24, marginy: 24, ranker: "network-simplex" });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  // One layout edge per pair, in the direction first seen. Every edge is still
  // drawn; this only places nodes. Opposite edges between a pair (an sdk call
  // one way, a flipped webhook the other) make dagre throw "Not possible to
  // find intersection inside of the rectangle".
  const ids = new Set(nodes.map((n) => n.id));
  const pairs = new Map<string, { from: string; to: string; weight: number }>();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    const flip = e.kind === "consume" || e.kind === "webhook";
    const [from, to] = flip ? [e.to, e.from] : [e.from, e.to];
    const key = [from, to].sort().join("\0");
    const weight = e.kind === "call" ? 2 : 1;
    const seen = pairs.get(key);
    if (seen) seen.weight += weight;
    else pairs.set(key, { from, to, weight });
  }
  for (const { from, to, weight } of pairs.values()) g.setEdge(from, to, { weight, minlen: 1 });

  try {
    dagre.layout(g);
  } catch (err) {
    console.warn("Cartograph: layout failed, falling back to a grid", err);
    return gridLayout(nodes);
  }

  // Dagre reserves horizontal room for edges that skip ranks, which spreads a
  // 15-node map across ~2000px. Keep its order within each rank, but re-space
  // every rank evenly and centre it: same reading order, far less empty space.
  const ranks = new Map<number, Array<{ id: string; x: number }>>();
  for (const n of nodes) {
    const p = g.node(n.id) as { x: number; y: number } | undefined;
    if (!p) continue;
    const y = Math.round(p.y);
    if (!ranks.has(y)) ranks.set(y, []);
    ranks.get(y)!.push({ id: n.id, x: p.x });
  }
  // A rank wider than MAX_ROW (often parts with no arrows, which all land on
  // top) wraps onto extra lines, pushing the ranks below it down. Its nodes
  // are ordered so arrows don't cut through a wrapped line: arrows in from
  // above on the top line, unlinked parts in the middle, arrows out below on
  // the bottom line.
  const side = (id: string) => {
    const up = (g.predecessors(id) ?? []).length > 0;
    const down = (g.successors(id) ?? []).length > 0;
    return up && !down ? 0 : !up && !down ? 1 : up ? 2 : 3;
  };
  const out = new Map<string, Positioned>();
  const step = NODE_W + GAP_X;
  let shift = 0;
  for (const [y, row] of [...ranks].sort((a, b) => a[0] - b[0])) {
    row.sort((a, b) => a.x - b.x);
    const lines = Math.ceil(row.length / MAX_ROW);
    if (lines > 1) row.sort((a, b) => side(a.id) - side(b.id) || a.x - b.x);
    const perLine = Math.ceil(row.length / lines);
    for (let l = 0; l < lines; l++) {
      const line = row.slice(l * perLine, (l + 1) * perLine);
      const width = line.length * NODE_W + (line.length - 1) * GAP_X;
      line.forEach((n, i) => out.set(n.id, { x: -width / 2 + i * step, y: y + shift + l * LINE_H - NODE_H / 2 }));
    }
    shift += (lines - 1) * LINE_H;
  }
  return out;
}

/** Last resort if dagre still fails: a plain grid, centred like the layout above, so a map always opens. */
function gridLayout(nodes: CartographNode[]): Map<string, Positioned> {
  const cols = Math.min(MAX_ROW, Math.ceil(Math.sqrt(nodes.length)));
  const width = cols * NODE_W + (cols - 1) * GAP_X;
  const out = new Map<string, Positioned>();
  nodes.forEach((n, i) => out.set(n.id, { x: -width / 2 + (i % cols) * (NODE_W + GAP_X), y: Math.floor(i / cols) * LINE_H }));
  return out;
}
