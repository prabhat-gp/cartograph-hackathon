import { z } from "zod";
import { EDGE_KINDS, NODE_KINDS, SEVERITIES } from "../../shared/graph";

// Agent output schemas. Lists that can legitimately be empty default to [] so a
// model that leaves one out doesn't cost the whole answer.
export const ComponentSchema = z.object({
  id: z.string(), kind: z.enum(NODE_KINDS), label: z.string(),
  tech: z.string().nullable().default(null), summary: z.string(), paths: z.array(z.string()).default([]),
});
export const ReaderGroupSchema = z.object({
  name: z.string(), focus: z.string(), files: z.array(z.string()).default([]),
});
export const ScoutSchema = z.object({
  stack: z.array(z.string()).default([]), summary: z.string(), components: z.array(ComponentSchema).default([]),
  readerGroups: z.array(ReaderGroupSchema).default([]), flowHints: z.array(z.string()).default([]),
});
export const EvidenceSchema = z.object({
  path: z.string(), line: z.number().int().positive(), snippet: z.string(),
});
export const ReaderEdgeSchema = z.object({
  from: z.string(), to: z.string(), kind: z.enum(EDGE_KINDS), label: z.string(),
  evidence: z.array(EvidenceSchema).min(1),
});
export const ReaderSchema = z.object({
  edges: z.array(ReaderEdgeSchema).default([]), newComponents: z.array(ComponentSchema).default([]),
  componentNotes: z.array(z.object({ id: z.string(), details: z.array(z.string()) })).default([]),
});
export const NodeSchema = z.object({
  id: z.string(), kind: z.enum(NODE_KINDS), label: z.string(), summary: z.string(),
  tech: z.string().nullable().default(null),
  files: z.array(z.object({ path: z.string(), line: z.number().int().positive().nullable() })).default([]),
  details: z.array(z.string()).default([]),
});
export const FlowSchema = z.object({
  id: z.string(), name: z.string(), trigger: z.string(), description: z.string(),
  steps: z.array(z.object({ edge: z.string(), note: z.string() })).min(1),
});
export const CartographerEdgeSchema = z.object({
  id: z.string(), from: z.string(), to: z.string(), kind: z.enum(EDGE_KINDS),
  label: z.string(), sources: z.array(z.string()).default([]),
});
export const CartographerSchema = z.object({
  nodes: z.array(NodeSchema).default([]), edges: z.array(CartographerEdgeSchema).default([]),
  flows: z.array(FlowSchema).default([]), summary: z.string(), stack: z.array(z.string()).default([]),
});
export const ReviewerSchema = z.object({
  addNodes: z.array(NodeSchema).default([]),
  addEdges: z.array(ReaderEdgeSchema.extend({ id: z.string() })).default([]),
  removeEdgeIds: z.array(z.string()).default([]),
  findings: z.array(z.object({
    severity: z.enum(SEVERITIES), title: z.string(), detail: z.string(),
    nodeIds: z.array(z.string()), edgeIds: z.array(z.string()),
  })).default([]),
  summary: z.string(),
});
export const TracerSchema = z.object({
  flowId: z.string().nullable(), flow: FlowSchema.nullable(), answer: z.string(),
});
export type Component = z.infer<typeof ComponentSchema>;
export type ReaderGroup = z.infer<typeof ReaderGroupSchema>;
export type ReaderOutput = z.infer<typeof ReaderSchema>;
export type StructuredNode = z.infer<typeof NodeSchema>;
export type CartographerEdge = z.infer<typeof CartographerEdgeSchema>;
