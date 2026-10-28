// Cartograph UI shell: routes MCP tool results to views, polls for live changes,
// runs the trace player and derives the map's visual state.
import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CartographEdge, CartographGraph, CartographNode, DriftReport } from "../../shared/graph";
import { shortSha } from "../../shared/graph";
import { type FlowView, blastRadius, flowView } from "../../server/graph/analysis";
import type { Bridge, HostState, ToolResult } from "./bridge";
import { type EdgeVisual, Graph, type NodeVisual } from "./Graph";
import { ChevronsUpDown, CircleHelp, GitCommitHorizontal, Maximize2, Moon, PanelBottomClose, PanelBottomOpen, Route, ShieldCheck, Sun, X, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { CartographLogo } from "./icons";
import { DeskFooter, DeskHeader, GithubMark } from "./chrome";
import { CoverageLegend, DependencyPanel, type WhyCoverage } from "./why";
import { Button, IconButton, SeverityBadge, Spinner, cn } from "./ui";
import { PoweredBy } from "./status";
import { Tour, type TourAction, TourOffer, buildTourSteps, tourDone } from "./tour";
import { BlastPanel, DriftPanel, FlowsPanel, Home, NodePanel, OverviewPanel, Progress, TracePanel } from "./panels";

export interface JobView {
  id: string;
  kind: "map" | "review";
  status: "running" | "done" | "error";
  repoName: string;
  startedAt: string;
  error?: string;
  reportId?: string;
  log: Array<{ agent: string; phase: string; message: string; at: string }>;
}

export interface RepoSummary {
  key: string;
  name: string;
  sha: string | null;
  components: number;
  dependencies: number;
  mapping: string | null;
}

type Mode =
  | { kind: "explore" }
  | { kind: "trace"; flow: FlowView; step: number; playing: boolean }
  | { kind: "blast"; nodeId: string }
  | { kind: "drift"; reportId: string | null };

type Tab = "overview" | "flows" | "drift";
type GraphResult = ToolResult<{ graph: CartographGraph | null; mapping: string | null }>;

const STEP_MS = 1500;

export function App({ bridge }: { bridge: Bridge }) {
  const [host, setHost] = useState<HostState>(bridge.host());
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [repoKey, setRepoKey] = useState<string | null>(null);
  const [graph, setGraph] = useState<CartographGraph | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [reports, setReports] = useState<DriftReport[]>([]);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "explore" });
  const [tab, setTab] = useState<Tab>("overview");
  const [selected, setSelected] = useState<string | null>(null);
  /** A clicked dependency (arrow): opens "Why is this here?". */
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [coverageOn, setCoverageOn] = useState(false);
  const [coverage, setCoverage] = useState<{ repo: string; data: WhyCoverage | null; error: string | null } | null>(null);
  const [toast, setToast] = useState<DriftReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Standalone only: manual theme override (inside an MCP host the host decides).
  const [themePref, setThemePref] = useState<"light" | "dark" | null>(() => {
    try {
      const v = localStorage.getItem("cartograph.theme");
      return v === "light" || v === "dark" ? v : null;
    } catch {
      return null;
    }
  });
  const [demo, setDemo] = useState(false);
  const [demoMsg, setDemoMsg] = useState<string | null>(null);
  // The repo picker (Home) opened over a loaded map.
  const [home, setHome] = useState(false);
  // Narrow layouts stack the panel under the map; it can be tucked away.
  const [panelOpen, setPanelOpen] = useState(true);
  // Newest drift report seen, per repo: polling only asks for reports after it.
  const lastReport = useRef<{ repo: string; id?: string } | null>(null);
  const pendingTraceRef = useRef<FlowView | null>(null);
  // First-run tour: offered once per browser on a finished map, replayable from the header.
  const [tourOpen, setTourOpen] = useState(false);
  const [tourOffered, setTourOffered] = useState(() => tourDone());

  // Maps already fetched (or prefetched on hover), by repo: reopening one is instant.
  const graphCache = useRef(new Map<string, CartographGraph>());
  // One request per repo at a time: a hover prefetch and the click share it.
  const inflight = useRef(new Map<string, Promise<GraphResult>>());
  // The repo on screen now, so a slow answer for a repo you've left is dropped.
  const repoKeyRef = useRef<string | null>(null);
  repoKeyRef.current = repoKey;
  // A picked repo whose map is on its way: show "Opening…", not the picker.
  const [opening, setOpening] = useState(false);

  // ------------------------------------------------------------ data loading
  const fetchGraph = useCallback(
    (key: string): Promise<GraphResult> => {
      const running = inflight.current.get(key);
      if (running) return running;
      const p = bridge
        .callTool<{ graph: CartographGraph | null; mapping: string | null }>("cartograph_graph", { repo: key })
        .catch((e) => ({ structuredContent: { graph: null, mapping: null }, isError: true, text: String((e as Error)?.message ?? e) }))
        .then((r) => {
          const g = r.structuredContent.graph;
          if (!r.isError) {
            if (g) graphCache.current.set(key, g);
            else graphCache.current.delete(key);
          }
          return r as GraphResult;
        })
        .finally(() => inflight.current.delete(key));
      inflight.current.set(key, p);
      return p;
    },
    [bridge],
  );

  const loadGraph = useCallback(
    async (key: string) => {
      const r = await fetchGraph(key);
      if (repoKeyRef.current !== key) return null;
      if (r.isError) {
        setLoadError(r.text ?? "the request was refused");
        return null;
      }
      setLoadError(null);
      const { graph: g, mapping } = r.structuredContent;
      // No map on the server any more (and none being made): drop a cached one.
      if (g || !mapping) setGraph(g);
      if (mapping) setJobId(mapping);
      return g;
    },
    [fetchGraph],
  );

  // In a browser only: inside an MCP host every prefetch would be a visible tool call.
  const prefetchGraph = useCallback(
    (key: string) => {
      if (bridge.mode !== "standalone" || graphCache.current.has(key)) return;
      void fetchGraph(key);
    },
    [bridge.mode, fetchGraph],
  );

  useEffect(() => {
    if (graph) graphCache.current.set(graph.repo.key, graph);
  }, [graph]);

  const loadRepos = useCallback(async () => {
    const r = await bridge.callTool<{ repos: RepoSummary[] }>("cartograph_repos", {});
    const list = r.structuredContent.repos ?? [];
    setRepos(list);
    // Opened from an MCP host's sidebar while a map is running? Show its live progress.
    // A browser always starts at home; a running map shows there with a "mapping" badge.
    const running = bridge.mode === "host" ? list.find((x) => x.mapping) : undefined;
    if (running) {
      setRepoKey((k) => k ?? running.key);
      setJobId((j) => j ?? running.mapping);
    }
  }, [bridge]);

  const handleResult = useCallback(
    (r: ToolResult) => {
      setReady(true);
      if (r.isError) {
        setError(r.text ?? "Something went wrong");
        return;
      }
      setError(null);
      const sc = r.structuredContent as Record<string, any>;
      // The full graph (and drift reports) ride along in _meta, so we can draw immediately.
      const metaGraph = r.meta?.["cartograph/graph"] as CartographGraph | undefined;
      if (metaGraph) setGraph(metaGraph);
      const metaReports = r.meta?.["cartograph/reports"] as DriftReport[] | undefined;
      if (metaReports?.length) {
        setReports(metaReports);
        if (sc.repoKey) lastReport.current = { repo: sc.repoKey, id: metaReports[0].id };
      }
      if (Array.isArray(sc.repos) && sc.view !== "drift") setRepos(sc.repos);
      if (sc.repoKey) setRepoKey(sc.repoKey);
      if (sc.jobId && (sc.status === "running" || sc.view === "drift")) setJobId(sc.jobId);
      switch (sc.view) {
        case "trace":
          pendingTraceRef.current = sc.flow as FlowView;
          setSelected(null);
          setMode({ kind: "trace", flow: sc.flow, step: 0, playing: true });
          setTab("flows");
          break;
        case "blast":
          setSelected(null);
          setMode({ kind: "blast", nodeId: sc.nodeId });
          break;
        case "drift":
          setMode({ kind: "drift", reportId: sc.reportId ?? null });
          setTab("drift");
          break;
        default:
          setMode({ kind: "explore" });
      }
    },
    [],
  );

  // ------------------------------------------------------------ boot
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await bridge.connect();
      if (cancelled) return;
      setHost(bridge.host());
      bridge.onHostChange(setHost);
      bridge.onToolResult(handleResult);
      if (bridge.mode === "standalone") {
        const q = new URLSearchParams(location.search);
        if (q.get("repo")) {
          const r = await bridge.callTool("cartograph", { repo: q.get("repo") });
          handleResult(r);
          if (q.get("drift")) {
            setMode({ kind: "drift", reportId: q.get("drift") });
            setTab("drift");
          }
        } else {
          // A browser visit starts at home: map a repository or pick one already mapped.
          setReady(true);
          await loadRepos();
        }
      } else {
        // Opened from the sidebar with no tool result yet: show what we have.
        setTimeout(() => {
          if (!cancelled) {
            setReady(true);
            void loadRepos();
          }
        }, 1200);
      }
    })().catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [bridge, handleResult, loadRepos]);

  useEffect(() => {
    document.documentElement.dataset.theme = (bridge.mode === "standalone" && themePref) || host.theme;
    document.documentElement.dataset.display = host.displayMode;
  }, [host, themePref, bridge.mode]);

  useEffect(() => {
    if (bridge.mode !== "standalone") return;
    fetch("health")
      .then((r) => r.json())
      .then((h) => setDemo(!!h.demo))
      .catch(() => undefined);
  }, [bridge.mode]);

  // In a browser the address follows the view: /app is home, /app?repo=… a map,
  // so a refresh keeps your place and Back returns home.
  useEffect(() => {
    if (bridge.mode !== "standalone" || !ready) return;
    const want = !home && repoKey ? `?repo=${encodeURIComponent(repoKey)}` : "";
    if (location.search !== want) history.pushState(null, "", `${location.pathname}${want}`);
  }, [bridge.mode, ready, home, repoKey]);

  useEffect(() => {
    if (bridge.mode !== "standalone") return;
    const onPop = () => {
      const key = new URLSearchParams(location.search).get("repo");
      if (key) {
        setHome(false);
        setRepoKey(key);
      } else {
        setHome(true);
        void loadRepos();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [bridge.mode, loadRepos]);

  // Repo changed → load its graph and drift history.
  useEffect(() => {
    if (!repoKey) return;
    let stale = false;
    // Switched repos: never keep drawing the previous repo's map. Draw the
    // cached one at once if we have it, and refresh it in the background.
    setGraph((g) => (g && g.repo.key === repoKey ? g : graphCache.current.get(repoKey) ?? null));
    setLoadError(null);
    setOpening(true);
    // A request that never comes back must not leave a spinner with no way out.
    const giveUp = setTimeout(() => {
      if (stale) return;
      setOpening(false);
      setLoadError((e) => e ?? "no answer after 20 seconds");
    }, 20000);
    void loadGraph(repoKey).finally(() => {
      clearTimeout(giveUp);
      if (!stale) setOpening(false);
    });
    void bridge
      .callTool<{ reports: DriftReport[] }>("cartograph_changes", { repo: repoKey })
      .then((r) => {
        if (r.isError || stale) return; // keep whatever arrived with the tool result
        const list = r.structuredContent.reports ?? [];
        setReports(list);
        lastReport.current = { repo: repoKey, id: list[0]?.id };
      })
      .catch(() => undefined);
    return () => {
      stale = true;
      clearTimeout(giveUp);
    };
  }, [repoKey, bridge, loadGraph]);

  // Poll an active job (mapping or review).
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    let misses = 0;
    const tick = async () => {
      // A dropped request (flaky network) waits for the next tick; ~20 s of them gives up.
      const r = await bridge.callTool<{ job: JobView | null }>("cartograph_job", { jobId }).catch(() => null);
      if (stop) return;
      if (!r || r.isError) {
        if (++misses >= 25) setJobId(null);
        return;
      }
      misses = 0;
      const j = r.structuredContent.job;
      if (stop) return;
      setJob(j);
      if (!j || j.status !== "running") {
        setJobId(null);
        if (j?.status === "done" && repoKey) {
          await loadGraph(repoKey);
          if (j.kind === "review") await pollChanges(true);
        }
      }
    };
    void tick();
    const t = setInterval(tick, 800);
    return () => {
      stop = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, bridge, repoKey, loadGraph]);

  // Live: watch for new drift reports (pushes reviewed by the webhook).
  const pollChanges = useCallback(
    async (focus = false) => {
      // Until this repo's history has loaded, every old report would look new.
      if (!repoKey || lastReport.current?.repo !== repoKey) return;
      const r = await bridge.callTool<{ reports: DriftReport[]; reviewing: { id: string } | null }>("cartograph_changes", {
        repo: repoKey,
        after: lastReport.current.id,
      });
      const fresh = r.structuredContent.reports ?? [];
      setReviewing(r.structuredContent.reviewing?.id ?? null);
      if (fresh.length === 0 || lastReport.current?.repo !== repoKey) return;
      lastReport.current = { repo: repoKey, id: fresh[0].id };
      setReports((prev) => [...fresh, ...prev.filter((p) => !fresh.some((f) => f.id === p.id))]);
      await loadGraph(repoKey);
      const newest = fresh[0];
      if (newest.maxSeverity !== "none") setToast(newest);
      if (focus || newest.maxSeverity === "critical" || newest.maxSeverity === "warning") {
        setSelected(null);
        setMode({ kind: "drift", reportId: newest.id });
        setTab("drift");
      } else {
        // Already looking at drift? Follow the newest push, even a clean one.
        setMode((m) => (m.kind === "drift" ? { kind: "drift", reportId: newest.id } : m));
      }
    },
    [repoKey, bridge, loadGraph],
  );

  useEffect(() => {
    if (!repoKey || !graph) return;
    // Inside an MCP host every poll is a tool call: keep it modest, and pause when hidden.
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void pollChanges();
    }, 5000);
    return () => clearInterval(t);
  }, [repoKey, graph, pollChanges]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 9000);
    return () => clearTimeout(t);
  }, [toast]);

  // Anything that puts new details in the (narrow-layout) panel brings it back.
  useEffect(() => {
    setPanelOpen(true);
  }, [tab, mode.kind, selected]);

  // ------------------------------------------------------------ trace player
  useEffect(() => {
    if (mode.kind !== "trace" || !mode.playing) return;
    const t = setTimeout(() => {
      setMode((m) => {
        if (m.kind !== "trace") return m;
        const last = m.flow.steps.length - 1;
        return m.step >= last ? { ...m, playing: false } : { ...m, step: m.step + 1 };
      });
    }, STEP_MS);
    return () => clearTimeout(t);
  }, [mode]);

  // ------------------------------------------------------------ model context
  const nodesById = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);
  useEffect(() => {
    if (!graph) return;
    const repo = `${graph.repo.name}@${shortSha(graph.sha)}`;
    let text = "";
    if (mode.kind === "trace") {
      const s = mode.flow.steps[mode.step];
      text = s ? `In Cartograph (${repo}) the user is watching the "${mode.flow.name}" flow, step ${s.index}/${mode.flow.steps.length}: ${s.from.label} → ${s.to.label} (${s.label}).` : "";
    } else if (mode.kind === "blast") {
      text = `In Cartograph (${repo}) the user is simulating an outage of ${nodesById.get(mode.nodeId)?.label ?? mode.nodeId}.`;
    } else if (mode.kind === "drift") {
      const r = reports.find((x) => x.id === mode.reportId) ?? reports[0];
      text = r ? `In Cartograph (${repo}) the user is viewing architecture drift for ${shortSha(r.toSha)} ("${r.commits[0]?.message ?? ""}"): ${r.summary}` : "";
    } else if (selected) {
      const n = nodesById.get(selected);
      text = n ? `In Cartograph (${repo}) the user selected the component "${n.label}" (${n.kind}${n.tech ? `, ${n.tech}` : ""}): ${n.summary}` : "";
    }
    if (!text) return;
    const t = setTimeout(() => void bridge.updateContext(text), 400);
    return () => clearTimeout(t);
  }, [graph, mode, selected, reports, nodesById, bridge]);

  // ------------------------------------------------------------ derived visuals
  const activeReport = mode.kind === "drift" ? (reports.find((r) => r.id === mode.reportId) ?? reports[0]) : undefined;

  const visuals = useMemo(() => {
    const nodeVisual: Record<string, NodeVisual> = {};
    const edgeVisual: Record<string, EdgeVisual> = {};
    const badges: Record<string, string> = {};
    let ghostNodes: CartographNode[] = [];
    let ghostEdges: CartographEdge[] = [];
    let defaultNode: NodeVisual = "base";
    let defaultEdge: EdgeVisual = "base";
    let pulseKey: string | undefined;
    if (!graph) return { nodeVisual, edgeVisual, badges, ghostNodes, ghostEdges, defaultNode, defaultEdge, pulseKey };

    if (mode.kind === "trace") {
      defaultNode = "dim";
      defaultEdge = "dim";
      mode.flow.steps.forEach((s, i) => {
        if (i > mode.step) return;
        edgeVisual[s.edgeId] = i === mode.step ? "active" : "visited";
        nodeVisual[s.from.id] = nodeVisual[s.from.id] === "active" ? "active" : "path";
        nodeVisual[s.to.id] = "path";
      });
      const cur = mode.flow.steps[mode.step];
      if (cur) {
        nodeVisual[cur.to.id] = "active";
        badges[cur.to.id] = String(cur.index);
      }
      pulseKey = `${mode.flow.id}-${mode.step}`;
    } else if (mode.kind === "blast") {
      const b = blastRadius(graph, mode.nodeId);
      if (b) {
        defaultNode = "dim";
        defaultEdge = "dim";
        nodeVisual[b.node.id] = "dead";
        badges[b.node.id] = "DOWN";
        for (const i of b.impacted) {
          nodeVisual[i.node.id] = "impacted";
          badges[i.node.id] = i.depth === 1 ? "direct" : `${i.depth} hops`;
        }
        for (const id of b.edgeIds) edgeVisual[id] = "blast";
      }
    } else if (mode.kind === "drift" && activeReport) {
      defaultNode = "dim";
      defaultEdge = "dim";
      const flaggedEdges = new Set(activeReport.findings.filter((f) => f.severity !== "info").flatMap((f) => f.edgeIds));
      const flaggedNodes = new Set(activeReport.findings.filter((f) => f.severity !== "info").flatMap((f) => f.nodeIds));
      for (const e of activeReport.added.edges) {
        edgeVisual[e.id] = flaggedEdges.has(e.id) ? "flagged" : "added";
        nodeVisual[e.from] ??= "base";
        nodeVisual[e.to] ??= "base";
      }
      for (const n of activeReport.added.nodes) {
        nodeVisual[n.id] = "new";
        badges[n.id] = "NEW";
      }
      for (const id of flaggedNodes) {
        if (nodeVisual[id] !== "new") nodeVisual[id] = "flagged";
      }
      ghostNodes = activeReport.removed.nodes;
      ghostEdges = activeReport.removed.edges;
      for (const n of ghostNodes) {
        nodeVisual[n.id] = "removed";
        badges[n.id] = "REMOVED";
      }
      for (const e of ghostEdges) edgeVisual[e.id] = "removed";
    } else if (selectedEdge) {
      defaultNode = "dim";
      defaultEdge = "dim";
      const e = graph.edges.find((x) => x.id === selectedEdge);
      if (e) {
        edgeVisual[e.id] = "selected";
        nodeVisual[e.from] = "selected";
        nodeVisual[e.to] = "selected";
      }
    } else if (coverageOn && coverage?.data && coverage.repo === graph.repo.key) {
      for (const e of graph.edges) edgeVisual[e.id] = `cov-${coverage.data.edges[e.id]?.status ?? "unknown"}` as EdgeVisual;
    } else if (selected) {
      defaultNode = "dim";
      defaultEdge = "dim";
      nodeVisual[selected] = "selected";
      for (const e of graph.edges) {
        if (e.from === selected || e.to === selected) {
          edgeVisual[e.id] = "selected";
          nodeVisual[e.from === selected ? e.to : e.from] ??= "path";
        }
      }
    }
    return { nodeVisual, edgeVisual, badges, ghostNodes, ghostEdges, defaultNode, defaultEdge, pulseKey };
  }, [graph, mode, selected, selectedEdge, coverageOn, coverage, activeReport]);

  // What to zoom to: the traced path, the outage, or the change. Refits once per
  // mode/flow/report (not per trace step), so the camera doesn't jump around.
  const focus = useMemo((): { key: string; ids: string[] | undefined } => {
    if (!graph) return { key: "none", ids: undefined };
    if (mode.kind === "trace") {
      return { key: `trace-${mode.flow.id}`, ids: [...new Set(mode.flow.steps.flatMap((s) => [s.from.id, s.to.id]))] };
    }
    if (mode.kind === "blast") {
      const b = blastRadius(graph, mode.nodeId);
      return { key: `blast-${mode.nodeId}`, ids: b ? [b.node.id, ...b.impacted.map((i) => i.node.id)] : undefined };
    }
    if (mode.kind === "drift" && activeReport) {
      const ids = new Set<string>();
      for (const e of [...activeReport.added.edges, ...activeReport.removed.edges]) {
        ids.add(e.from);
        ids.add(e.to);
      }
      for (const n of [...activeReport.added.nodes, ...activeReport.removed.nodes]) ids.add(n.id);
      for (const f of activeReport.findings) f.nodeIds.forEach((id) => ids.add(id));
      // A lone edge zoomed to 130% loses its context; show its neighbourhood too.
      return { key: `drift-${activeReport.id}`, ids: ids.size >= 3 ? [...ids] : undefined };
    }
    return { key: "all", ids: undefined };
  }, [graph, mode, activeReport]);

  // ------------------------------------------------------------ actions
  const ask = (text: string) => void bridge.sendMessage(text);
  const startTrace = (flowId: string) => {
    if (!graph) return;
    const f = graph.flows.find((x) => x.id === flowId);
    if (!f) return;
    setSelected(null);
    setMode({ kind: "trace", flow: flowView(graph, f), step: 0, playing: true });
    setTab("flows");
  };
  const exitMode = () => {
    setMode({ kind: "explore" });
  };
  // Leaving the current map: whichever repo opens next starts from a clean view.
  const resetView = () => {
    setSelected(null);
    setSelectedEdge(null);
    setCoverageOn(false);
    setMode({ kind: "explore" });
    setTab("overview");
    setToast(null);
  };
  const openHome = () => {
    setHome(true);
    void bridge
      .callTool<{ repos: RepoSummary[] }>("cartograph_repos", {})
      .then((r) => setRepos(r.structuredContent.repos ?? []))
      .catch(() => undefined);
  };
  const openRepo = (key: string) => {
    setHome(false);
    if (key === repoKey) return;
    resetView();
    setJob(null);
    setReports([]);
    setRepoKey(key);
    // A first map still in progress: follow it live.
    const running = repos.find((r) => r.key === key)?.mapping;
    if (running) setJobId(running);
  };
  const mapRepo = async (repo: string) => {
    setError(null);
    const r = await bridge.callTool("map_repo", { repo });
    if (!r.isError) {
      resetView();
      if ((r.structuredContent as { repoKey?: string }).repoKey !== repoKey) {
        setJob(null);
        setReports([]);
      }
      setHome(false);
    }
    handleResult(r);
  };
  const runDemo = async (action: "drift" | "fix") => {
    setDemoMsg(action === "drift" ? "Committing “feat(cart): show live stock on cart page”…" : "Committing the fix…");
    const r = await fetch(`api/demo/${action}`, { method: "POST" }).then((x) => x.json()).catch(() => ({ ok: false, output: "Server unreachable" }));
    setDemoMsg(r.ok ? `${r.output.split("\n")[0]} · Cartograph is reviewing it…` : r.output);
    setTimeout(() => setDemoMsg(null), 8000);
  };
  const toggleCoverage = async () => {
    if (!graph) return;
    const next = !coverageOn;
    setCoverageOn(next);
    setSelectedEdge(null);
    setSelected(null);
    if (!next || (coverage?.repo === graph.repo.key && coverage.data)) return;
    const key = graph.repo.key;
    setCoverage({ repo: key, data: null, error: null });
    const r = await bridge.callTool<WhyCoverage>("why_coverage", { repo: key });
    setCoverage({ repo: key, data: r.isError ? null : r.structuredContent, error: r.isError ? (r.text ?? "Could not read the history") : null });
  };
  const toggleTheme = () => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    setThemePref(next);
    try {
      localStorage.setItem("cartograph.theme", next);
    } catch {
      /* private mode: fine, just not remembered */
    }
  };
  const tourAction = useCallback((a: TourAction) => {
    setCoverageOn(false);
    setMode({ kind: "explore" });
    setSelected(a.kind === "node" ? a.id : null);
    setSelectedEdge(a.kind === "edge" ? a.id : null);
    setTab(a.kind === "tab" ? a.tab : "overview");
  }, []);
  const tourSteps = useMemo(() => (graph ? buildTourSteps(graph, reports.length) : []), [graph, reports.length]);
  const startTour = () => {
    setTourOffered(true);
    setTourOpen(true);
  };
  const checkNow = async () => {
    if (!graph) return;
    const r = await bridge.callTool("check_drift", { repo: graph.repo.key });
    handleResult(r);
  };

  // ------------------------------------------------------------ render
  const inline = bridge.mode === "host" && host.displayMode === "inline";
  const height = inline ? Math.min(host.maxHeight ?? 620, 620) : undefined;
  const mapping = job && job.status === "running" && job.kind === "map";
  const shellStyle = { height: height ?? "100vh", minHeight: 420 };
  const standalone = bridge.mode === "standalone";
  const dark = (themePref ?? host.theme) === "dark";
  const themeButton = standalone && (
    <IconButton label="Toggle dark mode" onClick={toggleTheme}>
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </IconButton>
  );

  if (!ready) {
    return (
      <div className="grid h-[240px] place-items-center text-muted">
        <span className="flex items-center gap-2 text-[13px]">
          <Spinner /> Opening Cartograph…
        </span>
      </div>
    );
  }

  if (repoKey && !graph && loadError && !mapping && !jobId && !opening) {
    return (
      <div className="flex flex-col bg-bg" style={shellStyle}>
        <div className="mx-auto w-full max-w-[560px] px-6 py-10">
          <CartographLogo size={40} />
          <h1 className="mt-4 mb-2 font-serif text-[30px] font-normal text-text">Couldn't load the map</h1>
          <p className="m-0 text-[13.5px] leading-relaxed text-muted">
            {standalone ? (
              <>The server didn't send this map ({loadError}). Check your connection and try again.</>
            ) : (
              <>
                The host refused Cartograph's request ({loadError}). If Cartograph was just updated, <b className="text-text">refresh its tools</b> in your MCP client, then ask again.
              </>
            )}
          </p>
          <div className="mt-5 flex gap-2">
            <Button onClick={() => void loadGraph(repoKey)}>Try again</Button>
            <Button variant="ghost" onClick={openHome}>All maps</Button>
          </div>
        </div>
      </div>
    );
  }

  if (home || !repoKey || (!graph && !mapping && !jobId && !opening)) {
    // The whole window scrolls, so the scrollbar sits at its edge rather than beside the column.
    return (
      <div className="flex flex-col overflow-y-auto bg-bg" style={shellStyle}>
        <DeskHeader standalone={standalone} actions={<><PoweredBy callTool={(name, args) => bridge.callTool(name, args)} />{themeButton}</>} />
        <Home repos={repos} current={graph ? repoKey : null} onOpen={openRepo} onPeek={prefetchGraph} onMap={mapRepo} onBack={home && graph ? () => setHome(false) : undefined} error={error} />
        <DeskFooter />
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="flex flex-col bg-bg" style={shellStyle}>
        <DeskHeader standalone={standalone} actions={themeButton} />
        {jobId || job ? (
          <Progress job={job} />
        ) : (
          <div className="grid flex-1 place-items-center text-muted">
            <span className="flex items-center gap-2 text-[13px]">
              <Spinner /> Opening the map…
            </span>
          </div>
        )}
      </div>
    );
  }

  const unseenDrift = reports.filter((r) => r.maxSeverity !== "none").length;
  let panel;
  if (mode.kind === "trace") {
    panel = (
      <TracePanel
        flow={mode.flow}
        step={mode.step}
        playing={mode.playing}
        onStep={(step) => setMode({ ...mode, step, playing: false })}
        onPlay={() => setMode({ ...mode, playing: !mode.playing, step: !mode.playing && mode.step >= mode.flow.steps.length - 1 ? 0 : mode.step })}
        onClose={exitMode}
        onAsk={() => ask(`Walk me through the "${mode.flow.name}" flow in ${graph.repo.name}: what could go wrong at each step?`)}
      />
    );
  } else if (mode.kind === "blast") {
    panel = <BlastPanel graph={graph} nodeId={mode.nodeId} onClose={exitMode} onAsk={(t) => ask(t)} onTrace={startTrace} />;
  } else if (tab === "drift" || mode.kind === "drift") {
    panel = (
      <DriftPanel
        reports={reports}
        activeId={activeReport?.id ?? null}
        onSelect={(id) => {
          setSelected(null);
          setMode({ kind: "drift", reportId: id });
        }}
        onClose={() => {
          exitMode();
          setTab("overview");
        }}
        onAsk={(t) => ask(t)}
        onCheck={checkNow}
        reviewing={!!reviewing || (job?.kind === "review" && job.status === "running")}
        graph={graph}
        demo={demo ? { run: runDemo, message: demoMsg } : undefined}
      />
    );
  } else if (selectedEdge && graph.edges.some((e) => e.id === selectedEdge)) {
    panel = (
      <DependencyPanel
        graph={graph}
        edgeId={selectedEdge}
        coverage={coverage?.repo === graph.repo.key ? coverage.data?.edges[selectedEdge] : undefined}
        callTool={(name, args) => bridge.callTool(name, args)}
        onClose={() => setSelectedEdge(null)}
        onSelectNode={(id) => {
          setSelectedEdge(null);
          setSelected(id);
        }}
      />
    );
  } else if (selected) {
    panel = (
      <NodePanel
        graph={graph}
        nodeId={selected}
        onClose={() => setSelected(null)}
        onSelect={setSelected}
        onWhy={(edgeId) => {
          setSelected(null);
          setSelectedEdge(edgeId);
        }}
        onBlast={(id) => {
          setSelected(null);
          setMode({ kind: "blast", nodeId: id });
        }}
        onAsk={(t) => ask(t)}
      />
    );
  } else if (tab === "flows") {
    panel = <FlowsPanel graph={graph} onTrace={startTrace} onAsk={(t) => ask(t)} />;
  } else {
    panel = <OverviewPanel graph={graph} onTrace={startTrace} onSelect={setSelected} onAsk={(t) => ask(t)} />;
  }

  const switchTab = (t: Tab) => {
    setTab(t);
    setSelected(null);
    if (t === "drift") setMode({ kind: "drift", reportId: reports[0]?.id ?? null });
    else if (mode.kind === "drift" || mode.kind === "blast" || (t === "overview" && mode.kind === "trace")) setMode({ kind: "explore" });
  };
  const busy = !!reviewing || (job?.kind === "review" && job.status === "running");

  return (
    <div className="flex flex-col overflow-hidden bg-bg" style={shellStyle}>
      <DeskHeader
        standalone={standalone}
        center={
          <nav className="flex items-center gap-5">
            {(["overview", "flows", "drift"] as Tab[]).map((t) => (
              <button key={t} data-tour={`tab-${t}`} onClick={() => switchTab(t)} className={cn("relative flex h-8 items-center gap-1.5 text-[14px] transition-colors", tab === t ? "text-text" : "text-muted hover:text-text")}>
                <span>{t === "overview" ? "Map" : t === "flows" ? "Flows" : "Drift"}</span>
                {t === "drift" && unseenDrift > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 font-mono text-[10px] text-white">{unseenDrift}</span>}
                {tab === t && <motion.span layoutId="cg-tab" className="absolute inset-x-0 -bottom-[13px] h-[2px] bg-accent" transition={{ type: "spring", duration: 0.35, bounce: 0.15 }} />}
              </button>
            ))}
          </nav>
        }
        actions={
          <>
            <span
              className="inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-wide text-muted uppercase max-lg:hidden"
              title={`Every arrow on this map cites the file and line that proves it. ${graph.stats.edgesDropped} more were proposed but left off because their citation didn't match the code.`}
            >
              <ShieldCheck size={13} className="text-ok" /> {graph.stats.edgesVerified} arrows · each cited
            </span>
            <span className={cn("ml-2 inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-wide uppercase", busy ? "text-warn" : "text-muted")} title="Cartograph reviews every push to this repo">
              {busy ? <Spinner size={12} /> : <span className="cg-live-dot size-2 rounded-full bg-ok" />}
              <span className="max-sm:hidden">{busy ? "Reviewing push…" : "Live"}</span>
            </span>
            <PoweredBy callTool={(name, args) => bridge.callTool(name, args)} />
            <IconButton label="Take the tour" data-tour="replay" onClick={startTour}>
              <CircleHelp size={15} />
            </IconButton>
            {themeButton}
            {inline && (
              <IconButton label="Open full screen" onClick={() => void bridge.requestDisplayMode("fullscreen")}>
                <Maximize2 size={15} />
              </IconButton>
            )}
          </>
        }
      >
        <span className="mx-1 h-5 w-px bg-line-strong max-sm:hidden" />
        <button
          onClick={openHome}
          title="Switch repository, or map another one"
          className="-mx-1 flex min-w-0 items-center gap-1.5 rounded-[4px] px-1.5 py-1 font-mono text-[12.5px] text-muted transition-colors hover:bg-surface-2"
        >
          {graph.repo.source === "github" && <GithubMark size={13} className="shrink-0 text-faint" />}
          <span className="truncate font-medium text-text">{graph.repo.name}</span>
          <ChevronsUpDown size={12} className="shrink-0 text-faint" />
        </button>
        <span className="rounded-[4px] border border-line px-1.5 py-[1px] font-mono text-[10.5px] text-muted max-md:hidden" title={`Mapped ${new Date(graph.generatedAt).toLocaleString()} (${graph.mode})`}>
          {shortSha(graph.sha)}
        </span>
      </DeskHeader>

      <div className="flex min-h-0 flex-1 max-md:flex-col">
        <main data-tour="map" className="relative min-h-0 min-w-0 flex-1 bg-canvas">
          <ReactFlowProvider>
            <Graph
              graph={graph}
              ghostNodes={visuals.ghostNodes}
              ghostEdges={visuals.ghostEdges}
              nodeVisual={visuals.nodeVisual}
              edgeVisual={visuals.edgeVisual}
              badges={visuals.badges}
              defaultNodeVisual={visuals.defaultNode}
              defaultEdgeVisual={visuals.defaultEdge}
              pulseKey={visuals.pulseKey}
              fitKey={`${graph.repo.key}-${graph.nodes.length}-${visuals.ghostNodes.length}-${host.displayMode}-${focus.key}`}
              focusIds={focus.ids}
              onNodeClick={(id) => {
                if (mode.kind !== "explore") setMode({ kind: "explore" });
                if (tab === "drift") setTab("overview");
                setSelectedEdge(null);
                setSelected((s) => (s === id ? null : id));
              }}
              onEdgeClick={(id) => {
                if (mode.kind !== "explore") setMode({ kind: "explore" });
                if (tab === "drift") setTab("overview");
                setSelected(null);
                setSelectedEdge((s) => (s === id ? null : id));
              }}
              onPaneClick={() => {
                if (mode.kind === "explore") {
                  setSelected(null);
                  setSelectedEdge(null);
                }
              }}
            />
          </ReactFlowProvider>
          {mode.kind === "explore" && tab !== "drift" && (
            <CoverageLegend
              on={coverageOn}
              loading={coverageOn && coverage?.repo === graph.repo.key && !coverage.data && !coverage.error}
              error={coverageOn && coverage?.repo === graph.repo.key ? coverage.error : null}
              data={coverage?.repo === graph.repo.key ? coverage.data : null}
              onToggle={() => void toggleCoverage()}
            />
          )}

          {!tourOffered && !tourOpen && !inline && <TourOffer onStart={startTour} onDismiss={() => setTourOffered(true)} />}

          <AnimatePresence>
            {toast && (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: -12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ type: "spring", duration: 0.45, bounce: 0.2 }}
                className="absolute top-3.5 left-1/2 z-40 flex w-[min(560px,calc(100%-28px))] -translate-x-1/2 items-center gap-3 rounded-[6px] border border-line bg-surface px-3.5 py-3 shadow-pop"
                role="status"
              >
                <SeverityBadge level={toast.maxSeverity as "critical" | "warning" | "info"} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-text">{toast.findings[0]?.title ?? toast.summary}</div>
                  <div className="truncate text-[11.5px] text-muted">
                    New push <span className="font-mono">{shortSha(toast.toSha)}</span> · {toast.commits[0]?.message ?? "architecture changed"}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setMode({ kind: "drift", reportId: toast.id });
                    setTab("drift");
                    setToast(null);
                  }}
                >
                  View
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          {mode.kind !== "explore" && (
            <div className="absolute top-3.5 left-3.5 z-30 flex items-center gap-2 rounded-full border border-line bg-surface/95 py-1 pr-1 pl-3 text-[12px] font-medium text-text shadow-card backdrop-blur">
              {mode.kind === "trace" ? <Route size={13} className="text-accent" /> : mode.kind === "blast" ? <Zap size={13} className="text-danger" /> : <GitCommitHorizontal size={13} className="text-warn" />}
              <span className="max-w-[260px] truncate">
                {mode.kind === "trace" ? mode.flow.name : mode.kind === "blast" ? `${nodesById.get(mode.nodeId)?.label} is down` : "Drift view"}
              </span>
              <button onClick={() => (mode.kind === "drift" ? switchTab("overview") : exitMode())} aria-label="Exit" className="grid size-6 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-text">
                <X size={13} />
              </button>
            </div>
          )}

          <div className="pointer-events-none absolute right-3.5 bottom-3.5 z-20 flex items-center gap-3 rounded-[4px] border border-line bg-surface/90 px-2.5 py-1.5 text-[11px] text-muted backdrop-blur max-sm:hidden">
            <span className="flex items-center gap-1.5">
              <span className="h-px w-4 bg-[var(--edge)]" /> depends on
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full border-2 border-accent bg-white" /> request
            </span>
          </div>

          <button
            onClick={() => setPanelOpen((o) => !o)}
            className="absolute bottom-3.5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-[4px] border border-line bg-surface/95 px-3 py-1.5 text-[12px] font-medium text-muted shadow-card backdrop-blur transition-colors hover:text-text md:hidden"
          >
            {panelOpen ? <PanelBottomClose size={14} /> : <PanelBottomOpen size={14} />}
            {panelOpen ? "Hide details" : "Show details"}
          </button>
        </main>

        <aside className={cn("shrink-0 overflow-y-auto border-line bg-surface md:w-[384px] md:border-l max-md:h-[46%] max-md:border-t", !panelOpen && "max-md:hidden")}>
          <AnimatePresence mode="wait">
            <motion.div key={`${tab}-${mode.kind}-${selected ?? ""}-${mode.kind === "trace" ? mode.flow.id : ""}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
              {panel}
            </motion.div>
          </AnimatePresence>
        </aside>
      </div>

      {tourOpen && tourSteps.length > 0 && <Tour steps={tourSteps} onAction={tourAction} onClose={() => setTourOpen(false)} />}
      {error && <div className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-[4px] bg-danger px-3 py-2 text-[12.5px] text-white shadow-pop">{error}</div>}
    </div>
  );
}
