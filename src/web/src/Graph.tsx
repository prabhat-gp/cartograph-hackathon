// The map canvas: React Flow with custom component nodes and dependency edges.
// Visual state (trace / blast / drift / selection) arrives as plain maps so this
// component stays dumb and fast.
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  getBezierPath,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { CartographEdge, CartographGraph, CartographNode, NodeKind } from "../../shared/graph";
import { kindMeta } from "./kinds";
import { cn } from "./ui";
import { NODE_H, layoutGraph } from "./layout";

export type NodeVisual = "base" | "dim" | "selected" | "path" | "active" | "dead" | "impacted" | "new" | "removed" | "flagged";
export type EdgeVisual = "base" | "dim" | "selected" | "visited" | "active" | "blast" | "added" | "flagged" | "removed";

export interface GraphProps {
  graph: CartographGraph;
  ghostNodes?: CartographNode[];
  ghostEdges?: CartographEdge[];
  nodeVisual: Record<string, NodeVisual>;
  edgeVisual: Record<string, EdgeVisual>;
  /** Changes on every trace step so the packet animation restarts. */
  pulseKey?: string;
  badges?: Record<string, string>;
  defaultNodeVisual?: NodeVisual;
  defaultEdgeVisual?: EdgeVisual;
  onNodeClick?: (id: string) => void;
  onEdgeClick?: (id: string) => void;
  onPaneClick?: () => void;
  fitKey?: string;
  /** Nodes to zoom to (a traced path, an outage); everything when empty. */
  focusIds?: string[];
}

interface CartographNodeData extends Record<string, unknown> {
  node: CartographNode;
  visual: NodeVisual;
  badge?: string;
}

interface CartographEdgeData extends Record<string, unknown> {
  edge: CartographEdge;
  visual: EdgeVisual;
  pulseKey?: string;
}

const NODE_VISUAL: Record<NodeVisual, string> = {
  base: "border-line",
  dim: "border-line opacity-[0.32] saturate-[0.4]",
  selected: "border-accent ring-4 ring-accent/15 shadow-pop",
  path: "border-accent/45",
  active: "border-accent ring-4 ring-accent/20 shadow-pop -translate-y-0.5",
  dead: "border-danger bg-danger/[0.05] cg-ring-pulse",
  impacted: "border-danger/50 bg-danger/[0.035]",
  new: "border-ok ring-4 ring-ok/15",
  flagged: "border-danger cg-ring-pulse",
  removed: "border-dashed border-line-strong bg-transparent opacity-60 shadow-none",
};

const BADGE_VISUAL: Partial<Record<NodeVisual, string>> = {
  dead: "bg-danger text-white",
  impacted: "bg-danger/90 text-white",
  flagged: "bg-danger text-white",
  new: "bg-ok text-white",
  removed: "bg-faint text-white",
};

const ComponentNode = memo(function ComponentNode({ data }: NodeProps<Node<CartographNodeData>>) {
  const { node, visual, badge } = data;
  const k = kindMeta(node.kind as NodeKind);
  return (
    <div
      title={node.summary}
      className={cn(
        "group relative flex h-16 w-[232px] items-center gap-3 rounded-[4px] border bg-surface px-3 shadow-card transition-all duration-300 hover:shadow-pop",
        NODE_VISUAL[visual],
      )}
    >
      <Handle id="t" type="target" position={Position.Top} />
      <Handle id="b" type="source" position={Position.Bottom} />
      <Handle id="ts" type="source" position={Position.Top} />
      <Handle id="bt" type="target" position={Position.Bottom} />
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-[3px]", visual === "dead" ? "bg-danger/12 text-danger" : k.tile)}>
        <k.Icon size={18} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[13px] leading-[1.2] font-semibold tracking-[-0.01em] text-text">{node.label}</div>
        <div className="mt-0.5 truncate text-[11.5px] leading-tight text-muted">{node.tech || k.label}</div>
      </div>
      {badge && (
        <span
          className={cn(
            "absolute -top-2.5 right-3 rounded-full px-2 py-[2px] text-[10px] leading-none font-bold tracking-wide shadow-card",
            BADGE_VISUAL[visual] ?? "bg-accent text-white",
          )}
        >
          {badge}
        </span>
      )}
    </div>
  );
});

const DependencyEdge = memo(function DependencyEdge(props: EdgeProps<Edge<CartographEdgeData>>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props;
  // Fan endpoints out along the card edge (towards the other node) so arrows
  // don't all converge on one point in the middle of a card.
  const fan = Math.max(-72, Math.min(72, (targetX - sourceX) * 0.14));
  const [path, labelX, labelY] = getBezierPath({ sourceX: sourceX + fan, sourceY, targetX: targetX - fan, targetY, sourcePosition, targetPosition, curvature: 0.3 });
  const visual = data?.visual ?? "base";
  const edge = data?.edge;
  const glow = visual === "active" || visual === "added" || visual === "flagged" || visual === "blast";
  const showLabel = visual === "active" || visual === "selected" || visual === "added" || visual === "flagged";
  // Messages flow queue → worker even though the dependency points worker → queue.
  const reverse = edge?.kind === "consume";
  return (
    <>
      {glow && <path d={path} className={`cg-edge-glow ${visual}`} />}
      <path id={id} d={path} className={`cg-edge ${visual}`} markerEnd={markerEnd} />
      <path d={path} fill="none" stroke="transparent" strokeWidth={18} />
      {visual === "active" && (
        <circle key={data?.pulseKey} r={5} className="cg-packet">
          <animateMotion dur="1.1s" repeatCount="1" fill="freeze" path={path} {...(reverse ? { keyPoints: "1;0", keyTimes: "0;1", calcMode: "linear" } : {})} />
        </circle>
      )}
      {showLabel && edge && (
        <EdgeLabelRenderer>
          <div
            className={cn(
              "pointer-events-none absolute z-20 flex max-w-[260px] items-center gap-1.5 rounded-full border bg-surface/95 px-2 py-[3px] text-[11px] whitespace-nowrap shadow-card backdrop-blur",
              visual === "flagged" ? "border-danger/40 text-danger" : visual === "added" ? "border-ok/40 text-text" : "border-line text-text",
            )}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <span className="rounded bg-surface-3 px-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-muted">{edge.kind}</span>
            <span className="truncate">{edge.label}</span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const nodeTypes = { component: ComponentNode };
const edgeTypes = { dependency: DependencyEdge };

const markerColor: Record<EdgeVisual, string> = {
  base: "var(--edge)",
  dim: "var(--edge-dim)",
  selected: "var(--accent)",
  visited: "var(--accent)",
  active: "var(--accent)",
  blast: "var(--danger)",
  added: "var(--ok)",
  flagged: "var(--danger)",
  removed: "var(--faint)",
};

function FitOnChange({ fitKey, focusIds }: { fitKey?: string; focusIds?: string[] }) {
  const rf = useReactFlow();
  const focus = useRef(focusIds);
  focus.current = focusIds;
  useEffect(() => {
    const t = setTimeout(() => {
      const ids = focus.current;
      rf.fitView(
        ids?.length
          ? { nodes: ids.map((id) => ({ id })), padding: 0.2, duration: 400, maxZoom: 1.05 }
          : { padding: 0.12, duration: 350 },
      );
    }, 40);
    return () => clearTimeout(t);
  }, [fitKey, rf]);
  return null;
}

export function Graph(props: GraphProps) {
  const { graph, ghostNodes = [], ghostEdges = [], nodeVisual, edgeVisual, pulseKey, badges = {} } = props;
  const defNode = props.defaultNodeVisual ?? "base";
  const defEdge = props.defaultEdgeVisual ?? "base";

  const allNodes = useMemo(() => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    return [...graph.nodes, ...ghostNodes.filter((n) => !ids.has(n.id))];
  }, [graph, ghostNodes]);
  const allEdges = useMemo(() => {
    const ids = new Set(graph.edges.map((e) => e.id));
    return [...graph.edges, ...ghostEdges.filter((e) => !ids.has(e.id))];
  }, [graph, ghostEdges]);

  const positions = useMemo(() => layoutGraph(allNodes, allEdges), [allNodes, allEdges]);

  const rfNodes: Node<CartographNodeData>[] = useMemo(
    () =>
      allNodes.map((n) => ({
        id: n.id,
        type: "component",
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        data: { node: n, visual: nodeVisual[n.id] ?? defNode, badge: badges[n.id] },
        draggable: true,
        selectable: false,
        // Above every edge layer, so edge hit-areas never swallow node clicks.
        zIndex: 1000,
      })),
    [allNodes, positions, nodeVisual, defNode, badges],
  );

  const rfEdges: Edge<CartographEdgeData>[] = useMemo(
    () =>
      allEdges
        .filter((e) => positions.has(e.from) && positions.has(e.to))
        .map((e) => {
          const visual = edgeVisual[e.id] ?? defEdge;
          // Pick handles by where the nodes ended up, so arrows never loop around.
          const down = (positions.get(e.to)!.y ?? 0) >= (positions.get(e.from)!.y ?? 0) + NODE_H / 2;
          return {
            id: e.id,
            source: e.from,
            target: e.to,
            sourceHandle: down ? "b" : "ts",
            targetHandle: down ? "t" : "bt",
            type: "dependency",
            data: { edge: e, visual, pulseKey },
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: markerColor[visual] },
            zIndex: visual === "active" || visual === "flagged" || visual === "added" ? 10 : visual === "dim" ? 0 : 1,
          };
        }),
    [allEdges, positions, edgeVisual, defEdge, pulseKey],
  );

  // Refit when the container changes size (inline ↔ side panel ↔ fullscreen).
  const wrap = useRef<HTMLDivElement>(null);
  const [sizeKey, setSizeKey] = useState("");
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSizeKey(`${Math.round(width / 60)}x${Math.round(height / 60)}`);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrap} style={{ width: "100%", height: "100%" }}>
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.12 }}
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, n) => props.onNodeClick?.(n.id)}
      onEdgeClick={(_, e) => props.onEdgeClick?.(e.id)}
      onPaneClick={() => props.onPaneClick?.()}
      nodesConnectable={false}
      elementsSelectable={false}
    >
      <svg width="0" height="0" className="absolute">
        <defs>
          <linearGradient id="cg-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2f6bff" />
            <stop offset="100%" stopColor="#7c4dff" />
          </linearGradient>
        </defs>
      </svg>
      {/* Survey grid: fine lines every 24px, heavier every 120px. */}
      <Background id="minor" variant={BackgroundVariant.Lines} gap={24} lineWidth={1} color="var(--grid)" />
      <Background id="major" variant={BackgroundVariant.Lines} gap={120} lineWidth={1} color="var(--grid-major)" />
      <Controls showInteractive={false} position="bottom-left" />
      <FitOnChange fitKey={`${props.fitKey}|${sizeKey}`} focusIds={props.focusIds} />
    </ReactFlow>
    </div>
  );
}
