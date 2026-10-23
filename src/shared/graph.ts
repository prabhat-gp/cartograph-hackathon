// The Cartograph graph: the one data model shared by the agents, the server and the UI.
//
// Edges always point from the thing that acts to the thing it depends on
// (frontend → api, api → database, worker → queue). Every edge must carry
// evidence: a file, line and code snippet that proves the dependency exists.
import { z } from "zod";

export const NODE_KINDS = [
  "client", // browser, mobile app, CLI user
  "frontend", // web app pages/components
  "api", // HTTP route handlers / controllers
  "service", // business-logic modules
  "worker", // background jobs, consumers, cron
  "database",
  "cache",
  "queue",
  "storage", // object/file storage
  "external", // third-party APIs and SaaS
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const EDGE_KINDS = [
  "http", // HTTP/fetch/REST/GraphQL call
  "rpc", // gRPC / tRPC / internal RPC
  "sql", // database query or ORM call
  "cache", // cache read/write
  "publish", // enqueue / publish a message
  "consume", // subscribe / process messages (worker → queue)
  "sdk", // third-party SDK call
  "call", // in-process function/module call
  "webhook", // inbound callback from a third party
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const FileRefSchema = z.object({
  path: z.string(),
  line: z.number().int().positive().optional(),
});
export type FileRef = z.infer<typeof FileRefSchema>;

export const EvidenceSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  snippet: z.string(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const NodeSchema = z.object({
  id: z.string(),
  kind: z.enum(NODE_KINDS),
  label: z.string(),
  summary: z.string(),
  tech: z.string().optional(),
  files: z.array(FileRefSchema).default([]),
  /** Short facts such as endpoints ("POST /api/orders") or tables. */
  details: z.array(z.string()).default([]),
});
export type CartographNode = z.infer<typeof NodeSchema>;

export const EdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  kind: z.enum(EDGE_KINDS),
  label: z.string(),
  evidence: z.array(EvidenceSchema).min(1),
});
export type CartographEdge = z.infer<typeof EdgeSchema>;

export const FlowStepSchema = z.object({
  edge: z.string(),
  note: z.string(),
});
export type FlowStep = z.infer<typeof FlowStepSchema>;

export const FlowSchema = z.object({
  id: z.string(),
  name: z.string(),
  trigger: z.string(),
  description: z.string(),
  steps: z.array(FlowStepSchema).min(1),
});
export type CartographFlow = z.infer<typeof FlowSchema>;

export const RepoRefSchema = z.object({
  /** Stable id used for storage, e.g. "prabhat-gp__chai-commerce". */
  key: z.string(),
  source: z.enum(["github", "local"]),
  /** Display name, e.g. "prabhat-gp/chai-commerce". */
  name: z.string(),
  /** Clone URL (github) or absolute path (local). */
  location: z.string(),
  webUrl: z.string().optional(),
});
export type RepoRef = z.infer<typeof RepoRefSchema>;

export const AgentRunStatSchema = z.object({
  agent: z.string(),
  durationMs: z.number(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
});
export type AgentRunStat = z.infer<typeof AgentRunStatSchema>;

export const GraphStatsSchema = z.object({
  files: z.number(),
  tokens: z.number(),
  edgesProposed: z.number(),
  edgesVerified: z.number(),
  edgesDropped: z.number(),
  nodesDropped: z.number(),
  model: z.string(),
  durationMs: z.number(),
  agents: z.array(AgentRunStatSchema).default([]),
});
export type GraphStats = z.infer<typeof GraphStatsSchema>;

export const GraphSchema = z.object({
  version: z.literal(1),
  repo: RepoRefSchema,
  sha: z.string(),
  branch: z.string().optional(),
  generatedAt: z.string(),
  /** "full" = mapped from scratch, "incremental" = patched from a push. */
  mode: z.enum(["full", "incremental"]).default("full"),
  stack: z.array(z.string()),
  summary: z.string(),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  flows: z.array(FlowSchema),
  stats: GraphStatsSchema,
});
export type CartographGraph = z.infer<typeof GraphSchema>;

// ---------------------------------------------------------------------------
// Drift: what changed in the architecture between two commits.

export const SEVERITIES = ["info", "warning", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const DriftFindingSchema = z.object({
  id: z.string(),
  severity: z.enum(SEVERITIES),
  /** Rule id for deterministic findings ("layering.frontend-to-data"), or "reviewer". */
  rule: z.string(),
  title: z.string(),
  detail: z.string(),
  nodeIds: z.array(z.string()).default([]),
  edgeIds: z.array(z.string()).default([]),
  source: z.enum(["rule", "reviewer"]),
});
export type DriftFinding = z.infer<typeof DriftFindingSchema>;

export const CommitInfoSchema = z.object({
  sha: z.string(),
  message: z.string(),
  author: z.string().optional(),
});
export type CommitInfo = z.infer<typeof CommitInfoSchema>;

export const DriftReportSchema = z.object({
  id: z.string(),
  repoKey: z.string(),
  repoName: z.string(),
  fromSha: z.string(),
  toSha: z.string(),
  at: z.string(),
  commits: z.array(CommitInfoSchema).default([]),
  changedFiles: z.array(z.string()).default([]),
  added: z.object({ nodes: z.array(NodeSchema), edges: z.array(EdgeSchema) }),
  removed: z.object({ nodes: z.array(NodeSchema), edges: z.array(EdgeSchema) }),
  brokenFlows: z.array(z.string()).default([]),
  findings: z.array(DriftFindingSchema),
  summary: z.string(),
  maxSeverity: z.enum(["none", ...SEVERITIES]),
});
export type DriftReport = z.infer<typeof DriftReportSchema>;

// ---------------------------------------------------------------------------
// Helpers shared by server and UI.

/** Semantic identity of an edge, used to diff graphs across commits. */
export function edgeKey(e: Pick<CartographEdge, "from" | "to" | "kind">): string {
  return `${e.from}|${e.to}|${e.kind}`;
}

export function severityRank(s: Severity | "none"): number {
  return s === "critical" ? 3 : s === "warning" ? 2 : s === "info" ? 1 : 0;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
