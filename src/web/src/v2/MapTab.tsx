// Map: V1's architecture map of the same repository, the big picture next to
// the inventory's detail. Only the canvas and a node panel; the hackathon
// features (why, tours, drift, sponsors) stay in V1.
import { ReactFlowProvider } from "@xyflow/react";
import { ExternalLink, Map as MapIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CartographGraph } from "../../../shared/graph";
import type { Bridge } from "../bridge";
import { Graph, type NodeVisual } from "../Graph";
import { Button, Card, CodeCite, Eyebrow, KindChip, Spinner } from "../ui";
import { Empty } from "./parts";
import type { ProjectContext } from "./V2App";

interface JobLite {
  status: "running" | "done" | "error";
  error?: string;
  log: { message: string }[];
}

export function MapTab({ ctx, bridge }: { ctx: ProjectContext; bridge: Bridge }) {
  const repo = ctx.data.project.repo;
  const name = repo.source === "github" ? repo.name : repo.location;
  const [graph, setGraph] = useState<CartographGraph | null | undefined>(undefined);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobLite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await bridge.callTool<{ graph: CartographGraph | null; mapping: string | null }>("cartograph_graph", { repo: repo.name });
    setGraph(r.structuredContent.graph ?? null);
    if (r.structuredContent.mapping) setJobId(r.structuredContent.mapping);
  }, [bridge, repo.name]);
  useEffect(() => void load().catch(() => setGraph(null)), [load]);

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      const r = await bridge.callTool<{ job: JobLite | null }>("cartograph_job", { jobId }).catch(() => null);
      if (stop) return;
      const j = r?.structuredContent.job ?? null;
      setJob(j);
      if (j && j.status !== "running") {
        setJobId(null);
        if (j.status === "error") setError(j.error ?? "Mapping failed");
        void load();
        return;
      }
      setTimeout(tick, 1500);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [jobId, bridge, load]);

  const start = async () => {
    setError(null);
    const r = await bridge.callTool<{ jobId?: string; status?: string }>("map_repo", { repo: name });
    if (r.isError) return setError(r.text ?? "Mapping failed");
    if (r.structuredContent.jobId && r.structuredContent.status === "running") setJobId(r.structuredContent.jobId);
    else void load();
  };

  const node = graph?.nodes.find((n) => n.id === selected);
  const visuals = useMemo(() => {
    const nodeVisual: Record<string, NodeVisual> = {};
    const edgeVisual: Record<string, "selected" | "dim"> = {};
    if (graph && selected) {
      const near = new Set([selected]);
      for (const e of graph.edges) if (e.from === selected || e.to === selected) {
        near.add(e.from);
        near.add(e.to);
        edgeVisual[e.id] = "selected";
      }
      for (const n of graph.nodes) nodeVisual[n.id] = n.id === selected ? "selected" : near.has(n.id) ? "base" : "dim";
      for (const e of graph.edges) edgeVisual[e.id] ??= "dim";
    }
    return { nodeVisual, edgeVisual };
  }, [graph, selected]);

  if (graph === undefined) return <div className="grid h-full place-items-center"><Spinner /></div>;
  if (!graph) {
    return (
      <Empty title="No architecture map yet" action={jobId ? <span className="flex items-center gap-2 text-[12.5px] text-muted"><Spinner /> {job?.log.at(-1)?.message ?? "Mapping…"}</span> : <Button variant="primary" onClick={() => void start()}><MapIcon size={14} /> Map the architecture</Button>}>
        The map shows the services, databases, queues and third parties this repository talks to, with every connection cited in the code. Agents read the code to draw it, which takes a few minutes.
        {error && <span className="mt-2 block text-danger">{error}</span>}
      </Empty>
    );
  }
  const edges = node ? graph.edges.filter((e) => e.from === node.id || e.to === node.id) : [];
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  return (
    <div className="flex h-full min-h-[520px]">
      <main className="relative min-w-0 flex-1 bg-canvas">
        <ReactFlowProvider>
          <Graph graph={graph} nodeVisual={visuals.nodeVisual} edgeVisual={visuals.edgeVisual} fitKey={`${graph.repo.key}-${graph.nodes.length}`}
            onNodeClick={(id) => setSelected((s) => (s === id ? null : id))} onPaneClick={() => setSelected(null)} />
        </ReactFlowProvider>
        <div className="absolute top-3 left-3 rounded-[4px] border border-line bg-surface/95 px-2.5 py-1.5 font-mono text-[10.5px] text-muted shadow-card">
          {graph.nodes.length} components · {graph.edges.length} connections · map of {graph.sha?.slice(0, 7)}
          {graph.sha && graph.sha !== ctx.data.project.sha && <span className="text-warn"> · older than the scan</span>}
        </div>
      </main>
      {node && (
        <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-text bg-surface p-4 max-md:hidden">
          <KindChip kind={node.kind} />
          <h3 className="mt-1 mb-1 text-[16px] font-semibold text-text">{node.label}</h3>
          {node.tech && <div className="font-mono text-[11px] text-faint">{node.tech}</div>}
          <p className="mt-2 text-[12.5px] leading-relaxed text-text">{node.summary}</p>
          {node.details.length > 0 && <ul className="m-0 mb-3 space-y-0.5 pl-4 font-mono text-[11px] text-muted">{node.details.slice(0, 12).map((d) => <li key={d}>{d}</li>)}</ul>}
          {edges.length > 0 && <Eyebrow className="mt-4">Connections</Eyebrow>}
          <div className="space-y-3">
            {edges.map((e) => (
              <Card key={e.id} className="p-2.5">
                <div className="mb-1.5 text-[12px] text-text">{label(e.from)} <span className="text-faint">→</span> {label(e.to)} <span className="font-mono text-[10px] uppercase text-faint">{e.kind}</span></div>
                <div className="mb-1.5 text-[11.5px] text-muted">{e.label}</div>
                <CodeCite ev={e.evidence[0]} />
              </Card>
            ))}
          </div>
          <a href="?v=1" onClick={() => { try { localStorage.setItem("cartograph.version", "v1"); } catch { /* */ } }} className="mt-4 inline-flex items-center gap-1 text-[12px] text-muted underline underline-offset-2 hover:text-text">Trace flows in V1 <ExternalLink size={11} /></a>
        </aside>
      )}
    </div>
  );
}
