// Cartograph's use of H-MEM: every finding the Critic approved is
// remembered with the commits, pull requests and issues that prove it, one
// memory per repository. Later questions recall it, and a finding about
// lines that have since changed is superseded rather than trusted.
import path from "node:path";
import type { Draft, EvidenceItem } from "../agent/agents";
import { HMEM, type MemoryRecord, type QueryResult } from "./hmem";

const memories = new Map<string, HMEM>();

export function memoryDir(repo: string): string {
  return path.join(process.env.CARTOGRAPH_MEMORY_DIR ?? path.join(process.cwd(), ".cartograph", "memory"), repo.replace("/", "__"));
}

export function memoryFor(repo: string): HMEM {
  let m = memories.get(repo);
  if (!m) {
    m = new HMEM({ persistDir: memoryDir(repo), actor: "cartograph" });
    memories.set(repo, m);
  }
  return m;
}

export const RECALL_THRESHOLD = 0.2;

export interface Recall {
  result: QueryResult;
  /** Memories whose cited commits no longer own the lines they talk about. */
  stale: MemoryRecord[];
}

/**
 * What Cartograph already knows that's relevant to this question. `currentShas`
 * are the commits that own the asked-about lines today: a remembered finding
 * about the same file that cites none of them may be out of date.
 */
export function recall(repo: string, question: string, file: string | null, currentShas: string[]): Recall {
  const hmem = memoryFor(repo);
  // The spec's 0.35 default is tuned for chat memory; code questions share few
  // words with stored findings, so the file and domain signals carry more of the score.
  const result = hmem.query(question, { domain: repo, entities: file ? [file.toLowerCase()] : [], threshold: RECALL_THRESHOLD });
  const stale = file && currentShas.length
    ? result.memories
        .map((r) => r.memory)
        .filter((m) => m.tags.includes(`file:${file}`) && !m.supersededBy && m.entities.some((e) => /^[0-9a-f]{10}$/.test(e)))
        .filter((m) => !currentShas.some((sha) => m.entities.includes(sha.slice(0, 10))))
    : [];
  return { result, stale };
}

const CONFIDENCE = { high: 0.85, medium: 0.7, low: 0.5 } as const;

/** Stores each approved claim as a memory carrying its evidence as provenance. */
export function remember(input: {
  repo: string;
  question: string;
  file: string | null;
  draft: Draft;
  evidence: EvidenceItem[];
  runId: string;
  supersede: MemoryRecord[];
}): MemoryRecord[] {
  const hmem = memoryFor(input.repo);
  const byId = new Map(input.evidence.map((e) => [e.id, e]));
  const created: MemoryRecord[] = [];
  for (const claim of input.draft.claims) {
    const cited = claim.evidence.map((id) => byId.get(id)).filter((e): e is EvidenceItem => !!e && e.kind !== "memory");
    if (cited.length === 0) continue;
    const entities = [
      ...(input.file ? [input.file.toLowerCase()] : []),
      ...cited.filter((e) => e.kind === "commit").map((e) => e.ref.slice(0, 10)),
      ...cited.filter((e) => e.kind === "pull_request" || e.kind === "issue").map((e) => e.ref),
    ];
    // A new finding about the same lines replaces the stale one it overlaps most with.
    const replaces = input.supersede.find((m) => !m.supersededBy && m.tags.includes(`file:${input.file}`));
    created.push(hmem.add({
      content: claim.text,
      source: "cartograph:critic-approved",
      type: "factual",
      layer: input.draft.confidence === "high" ? "long_term" : "working",
      confidence: CONFIDENCE[input.draft.confidence],
      tags: ["why", ...(input.file ? [`file:${input.file}`] : []), `run:${input.runId}`],
      entities,
      domain: input.repo,
      namespace: input.file ? path.dirname(input.file) : "repository",
      provenance: {
        origin: "model_response",
        label: `Answer to "${input.question.slice(0, 120)}"`,
        refs: cited.map((e) => e.url ?? `${e.kind}:${e.ref}`),
      },
      ...(replaces ? { supersedes: replaces.id } : {}),
    }));
  }
  return created;
}

export function asEvidenceText(m: MemoryRecord): string {
  return `${m.content}\nremembered ${new Date(m.timestamp).toISOString().slice(0, 10)}, confidence ${m.confidence}, from ${(m.provenance.refs ?? []).slice(0, 4).join(", ")}`;
}
