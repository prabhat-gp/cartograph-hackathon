import { z } from "zod";
import { EDGE_KINDS, NODE_KINDS, SEVERITIES } from "../../shared/graph";

// Separate agent schemas from the shared schemas: strict outputs require every field.
export const ComponentSchema = z.object({
  id: z.string(), kind: z.enum(NODE_KINDS), label: z.string(),
  tech: z.string().nullable(), summary: z.string(), paths: z.array(z.string()),
});
export const ReaderGroupSchema = z.object({
  name: z.string(), focus: z.string(), files: z.array(z.string()),
});
export const ScoutSchema = z.object({
  stack: z.array(z.string()), summary: z.string(), components: z.array(ComponentSchema),
  readerGroups: z.array(ReaderGroupSchema), flowHints: z.array(z.string()),
});
export const EvidenceSchema = z.object({
  path: z.string(), line: z.number().int().positive(), snippet: z.string(),
});
export const ReaderEdgeSchema = z.object({
  from: z.string(), to: z.string(), kind: z.enum(EDGE_KINDS), label: z.string(),
  evidence: z.array(EvidenceSchema).min(1),
});
export const ReaderSchema = z.object({
  edges: z.array(ReaderEdgeSchema), newComponents: z.array(ComponentSchema),
  componentNotes: z.array(z.object({ id: z.string(), details: z.array(z.string()) })),
});
export const NodeSchema = z.object({
  id: z.string(), kind: z.enum(NODE_KINDS), label: z.string(), summary: z.string(),
  tech: z.string().nullable(),
  files: z.array(z.object({ path: z.string(), line: z.number().int().positive().nullable() })),
  details: z.array(z.string()),
});
export const FlowSchema = z.object({
  id: z.string(), name: z.string(), trigger: z.string(), description: z.string(),
  steps: z.array(z.object({ edge: z.string(), note: z.string() })).min(1),
});
export const CartographerEdgeSchema = z.object({
  id: z.string(), from: z.string(), to: z.string(), kind: z.enum(EDGE_KINDS),
  label: z.string(), sources: z.array(z.string()),
});
export const CartographerSchema = z.object({
  nodes: z.array(NodeSchema), edges: z.array(CartographerEdgeSchema),
  flows: z.array(FlowSchema), summary: z.string(), stack: z.array(z.string()),
});
export const ReviewerSchema = z.object({
  addNodes: z.array(NodeSchema),
  addEdges: z.array(ReaderEdgeSchema.extend({ id: z.string() })),
  removeEdgeIds: z.array(z.string()),
  findings: z.array(z.object({
    severity: z.enum(SEVERITIES), title: z.string(), detail: z.string(),
    nodeIds: z.array(z.string()), edgeIds: z.array(z.string()),
  })),
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
