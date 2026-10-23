// Contract between the Cartograph server and its agent "brain".
//
// The brain only *proposes*: every edge it returns is checked afterwards by
// src/server/graph/verify.ts, which drops anything whose evidence snippet is
// not literally present in the repo. So the brain must cite, never invent.
import type {
  AgentRunStat,
  CartographEdge,
  CartographFlow,
  CartographGraph,
  CartographNode,
  DriftFinding,
} from "../../shared/graph";
import type { ChangedFile, RepoSnapshot } from "../repo";

export type AgentName = "scout" | "reader" | "cartographer" | "tracer" | "reviewer";

export interface ProgressEvent {
  agent: AgentName | "pipeline";
  phase: "start" | "progress" | "done" | "error";
  /** Human-readable line shown live in the UI, e.g. "Reader 2/4 · api/routes (6 files)". */
  message: string;
  /** Small counters for the UI, e.g. { endpoints: 14, edges: 9 }. */
  data?: Record<string, number | string>;
}
export type OnProgress = (event: ProgressEvent) => void;

export interface BrainOptions {
  /** Overrides the tier model on the primary provider (see src/config.ts). */
  model?: string;
  onProgress?: OnProgress;
  signal?: AbortSignal;
}

/** An edge as proposed by agents: unverified evidence, draft id. */
export type DraftEdge = CartographEdge;
/** A flow whose steps reference DraftEdge ids. */
export type DraftFlow = CartographFlow;

export interface DraftGraph {
  stack: string[];
  summary: string;
  nodes: CartographNode[];
  edges: DraftEdge[];
  flows: DraftFlow[];
  agentStats: AgentRunStat[];
}

export interface ReviewInput {
  /** The verified graph at the previous commit. */
  graph: CartographGraph;
  /** Files at the new commit. */
  snapshot: RepoSnapshot;
  /** What changed between the two commits. */
  changes: ChangedFile[];
}

export interface ReviewResult {
  /** Components introduced by the change (ids must not clash with existing ones). */
  addNodes: CartographNode[];
  /** Dependencies introduced by the change; evidence must point into changed files. */
  addEdges: DraftEdge[];
  /** Ids of existing edges the change removes. */
  removeEdgeIds: string[];
  /** Architectural observations about the change, most important first. */
  findings: Array<Omit<DriftFinding, "id" | "source" | "rule">>;
  /** One or two sentences: what changed architecturally. */
  summary: string;
  agentStats: AgentRunStat[];
}

export interface TraceInput {
  graph: CartographGraph;
  question: string;
}

export interface TraceResult {
  /** Set when an existing flow in graph.flows answers the question. */
  flowId: string | null;
  /** Otherwise a new flow; steps must reference existing graph edge ids, in order. */
  flow: DraftFlow | null;
  /** Short plain-language answer for the chat. */
  answer: string;
  agentStats: AgentRunStat[];
}

/** What src/server/brain/index.ts must export. */
export interface Brain {
  mapRepository(snapshot: RepoSnapshot, opts?: BrainOptions): Promise<DraftGraph>;
  reviewChanges(input: ReviewInput, opts?: BrainOptions): Promise<ReviewResult>;
  traceQuestion(input: TraceInput, opts?: BrainOptions): Promise<TraceResult>;
}
