// H-MEM: Cartograph's memory, implemented to the Meterless H-MEM spec
// (engines/hmem/AGENTS.md). What Cartograph remembers is verified findings
// about a codebase, each with the commits, pull requests and issues that
// prove it. Every read and write goes through the trust ledger.
//
// Deterministic and dependency-free: embeddings are hashed bag-of-words
// vectors, so ranking is reproducible in tests and in sample mode.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

export type MemoryType = "personal" | "factual" | "preference" | "general";
export type MemoryLayer = "short_term" | "working" | "long_term";
export type ProvenanceOrigin =
  | "chat_message" | "user_correction" | "file_save" | "file_open" | "file_edit"
  | "model_response" | "plan_completion" | "document" | "manual" | "dream" | "sleep_synthesis";

export interface Provenance {
  origin: ProvenanceOrigin;
  learnedAt: number;
  label: string;
  refs?: string[];
}

export interface MemoryRecord {
  id: string;
  content: string;
  type: MemoryType;
  layer: MemoryLayer;
  timestamp: number;
  lastAccessed: number;
  accessCount: number;
  tags: string[];
  embedding: number[];
  score?: number;
  confidence: number;
  source: string;
  provenance: Provenance;
  chatId?: string;
  domain: string;
  namespace: string;
  entities: string[];
  relatedTo: string[];
  supersedes?: string;
  supersededBy?: string;
  derivedFrom?: string[];
}

export type LedgerAction =
  | "create" | "read" | "update" | "delete" | "feedback" | "promote" | "demote" | "merge"
  | "conflict_detected" | "conflict_resolved"
  | "sleep_consolidate" | "sleep_archive" | "sleep_synthesize"
  | "dream_proposed" | "dream_approved" | "dream_rejected" | "restore";

export interface LedgerEntry {
  memoryId: string;
  action: LedgerAction;
  actor: string;
  timestamp: number;
  previousState?: Partial<MemoryRecord>;
  newState?: Partial<MemoryRecord>;
  details?: Record<string, unknown>;
}

export const FEEDBACK_DELTAS = { helpful: 0.05, not_helpful: -0.03, wrong: -0.2 } as const;
export type FeedbackKind = keyof typeof FEEDBACK_DELTAS;

export const DEFAULTS = {
  retrievalTopN: 5,
  retrievalThreshold: 0.35,
  consolidationDays: 7,
  archiveMinDays: 30,
  archiveMaxAccess: 2,
  synthesisCosine: 0.82,
  dreamClusterMinSize: 2,
  dreamRelatedness: 0.35,
  maxDreamProposalsPerType: 8,
  conflictAutoResolveGate: 0.7,
  entityCap: 10,
  relatedCap: 5,
  recencyDays: 14,
} as const;

export const DAY_MS = 24 * 60 * 60 * 1000;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e9) / 1e9;

// ---------------------------------------------------------------- text tools

const STOP = new Set("a an and are as at be but by for from has have in is it its of on or that the this to was were will with we you our".split(" "));

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_.#/-]+/g) ?? []).map((t) => t.replace(/^[.#/-]+|[.#/-]+$/g, "")).filter((t) => t.length > 1 && !STOP.has(t));
}

const DIM = 256;
export function embed(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const t of tokenize(text)) {
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
    v[(h >>> 0) % DIM] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** File paths, PR/issue numbers, commit hashes and identifiers: what code memories are about. */
export function extractEntities(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b[\w.-]+\/[\w./-]+\.\w+\b/g)) found.add(m[0].toLowerCase());
  for (const m of text.matchAll(/#\d+\b/g)) found.add(m[0]);
  for (const m of text.matchAll(/\b[0-9a-f]{7,40}\b/g)) found.add(m[0].slice(0, 10));
  for (const m of text.matchAll(/\b[a-z]+[A-Z]\w*\b|\b\w+_\w+\b/g)) found.add(m[0].toLowerCase());
  return [...found].slice(0, DEFAULTS.entityCap);
}

// ------------------------------------------------------------------- ledger

export class TrustLedgerService {
  private entries: LedgerEntry[] = [];

  constructor(private clock: () => number, private file?: string) {
    if (file && existsSync(file)) {
      this.entries = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LedgerEntry);
    }
  }

  /** Append-only: entries are never edited or pruned. */
  log(entry: Omit<LedgerEntry, "timestamp">): LedgerEntry {
    const e = { ...entry, timestamp: this.clock() };
    this.entries.push(e);
    if (this.file) appendFileSync(this.file, JSON.stringify(e) + "\n");
    return e;
  }

  history(memoryId: string): LedgerEntry[] {
    return this.entries.filter((e) => e.memoryId === memoryId);
  }

  all(): LedgerEntry[] {
    return [...this.entries];
  }

  stats(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.entries) out[e.action] = (out[e.action] ?? 0) + 1;
    return out;
  }
}

// -------------------------------------------------------------------- store

export interface AddInput {
  content: string;
  source: string;
  type?: MemoryType;
  layer?: MemoryLayer;
  confidence?: number;
  tags?: string[];
  entities?: string[];
  domain?: string;
  namespace?: string;
  chatId?: string;
  provenance?: Partial<Provenance>;
  derivedFrom?: string[];
  supersedes?: string;
}

const snapshot = (m: MemoryRecord): Partial<MemoryRecord> => {
  const { embedding: _e, ...rest } = m;
  return structuredClone(rest);
};

export class MemoryStoreService {
  private records = new Map<string, MemoryRecord>();
  private backups = new Map<string, MemoryRecord[]>();

  constructor(private clock: () => number, private ledger: TrustLedgerService, private actor: string, private file?: string) {
    if (file && existsSync(file)) {
      for (const m of JSON.parse(readFileSync(file, "utf8")) as MemoryRecord[]) this.records.set(m.id, m);
    }
  }

  persist(): void {
    if (this.file) writeFileSync(this.file, JSON.stringify([...this.records.values()]));
  }

  add(input: AddInput): MemoryRecord {
    if (!input.source || !input.source.trim()) throw new Error("H-MEM: a memory needs a source");
    if (!input.content || !input.content.trim()) throw new Error("H-MEM: a memory needs content");
    const now = this.clock();
    const entities = [...new Set([...(input.entities ?? []), ...extractEntities(input.content)])].slice(0, DEFAULTS.entityCap);
    const record: MemoryRecord = {
      id: `mem-${randomUUID()}`,
      content: input.content.trim(),
      type: input.type ?? "factual",
      layer: input.layer ?? "working",
      timestamp: now,
      lastAccessed: now,
      accessCount: 0,
      tags: [...new Set(input.tags ?? [])],
      embedding: embed(input.content),
      confidence: clamp01(input.confidence ?? 0.7),
      source: input.source,
      provenance: {
        origin: input.provenance?.origin ?? (input.derivedFrom?.length ? "dream" : "manual"),
        learnedAt: input.provenance?.learnedAt ?? now,
        label: input.provenance?.label ?? input.source,
        ...(input.provenance?.refs ? { refs: input.provenance.refs } : {}),
      },
      chatId: input.chatId,
      domain: input.domain ?? "general",
      namespace: input.namespace ?? "general",
      entities,
      relatedTo: [],
      ...(input.derivedFrom?.length ? { derivedFrom: input.derivedFrom } : {}),
      ...(input.supersedes ? { supersedes: input.supersedes } : {}),
    };
    // Peer links: records sharing entities in the same domain, both directions.
    for (const other of this.records.values()) {
      if (record.relatedTo.length >= DEFAULTS.relatedCap) break;
      if (other.domain === record.domain && jaccard(other.entities, record.entities) > 0) {
        record.relatedTo.push(other.id);
        if (other.relatedTo.length < DEFAULTS.relatedCap) other.relatedTo.push(record.id);
      }
    }
    this.records.set(record.id, record);
    if (input.supersedes) {
      const old = this.records.get(input.supersedes);
      if (old) {
        const prev = snapshot(old);
        old.supersededBy = record.id;
        this.ledger.log({ memoryId: old.id, action: "update", actor: this.actor, previousState: prev, newState: snapshot(old), details: { supersededBy: record.id } });
      }
    }
    this.ledger.log({ memoryId: record.id, action: "create", actor: this.actor, newState: snapshot(record), details: { source: record.source } });
    this.persist();
    return record;
  }

  get(id: string): MemoryRecord | undefined {
    return this.records.get(id);
  }

  all(): MemoryRecord[] {
    return [...this.records.values()];
  }

  update(id: string, change: (m: MemoryRecord) => void, action: LedgerAction = "update", details?: Record<string, unknown>): MemoryRecord {
    const m = this.records.get(id);
    if (!m) throw new Error(`H-MEM: no memory ${id}`);
    const prev = snapshot(m);
    change(m);
    m.confidence = round(clamp01(m.confidence));
    this.ledger.log({ memoryId: id, action, actor: this.actor, previousState: prev, newState: snapshot(m), details });
    this.persist();
    return m;
  }

  delete(id: string, action: LedgerAction = "delete", details?: Record<string, unknown>): void {
    const m = this.records.get(id);
    if (!m) return;
    this.records.delete(id);
    this.ledger.log({ memoryId: id, action, actor: this.actor, previousState: snapshot(m), details });
    this.persist();
  }

  backup(): string {
    const id = `backup-${this.clock()}-${randomUUID().slice(0, 8)}`;
    this.backups.set(id, structuredClone(this.all()));
    return id;
  }

  restore(backupId: string): void {
    const saved = this.backups.get(backupId);
    if (!saved) throw new Error(`H-MEM: no backup ${backupId}`);
    this.records = new Map(saved.map((m) => [m.id, structuredClone(m)]));
    this.ledger.log({ memoryId: backupId, action: "restore", actor: this.actor, details: { records: saved.length } });
    this.persist();
  }
}

// ---------------------------------------------------------------- retrieval

export interface RetrievedMemory {
  memory: MemoryRecord;
  relevance: number;
}

export interface QueryResult {
  memories: RetrievedMemory[];
  context: string;
  trace: { retrievalReason: string; strategy: "minimal" | "personal" | "comprehensive"; scores: Record<string, number> };
}

const LAYER_WEIGHT: Record<MemoryLayer, number> = { long_term: 1, working: 0.8, short_term: 0.6 };

export class MemoryRetrievalService {
  constructor(private store: MemoryStoreService, private ledger: TrustLedgerService, private clock: () => number, private actor: string) {}

  /** The spec's hybrid score, before the confidence multiplier. */
  rawScore(m: MemoryRecord, q: { embedding: number[]; tokens: string[]; domain?: string; entities: string[] }): number {
    const semantic = Math.max(0, cosine(q.embedding, m.embedding));
    const keyword = jaccard(q.tokens.slice(0, 8), tokenize(m.content));
    const tag = jaccard(q.tokens, m.tags.flatMap((t) => tokenize(t)));
    const domain = q.domain && q.domain === m.domain ? 1 : 0;
    const entity = jaccard(q.entities, m.entities);
    const layer = LAYER_WEIGHT[m.layer];
    const recency = Math.exp(-(this.clock() - m.lastAccessed) / (DEFAULTS.recencyDays * DAY_MS));
    const superseded = m.supersededBy ? 1 : 0;
    return 0.35 * semantic + 0.2 * keyword + 0.1 * tag + 0.1 * domain + 0.15 * entity + 0.05 * layer + 0.05 * recency - 0.2 * superseded;
  }

  query(text: string, opts: { topN?: number; threshold?: number; chatId?: string; domain?: string; entities?: string[] } = {}): QueryResult {
    const q = { embedding: embed(text), tokens: tokenize(text), domain: opts.domain, entities: [...new Set([...(opts.entities ?? []), ...extractEntities(text)])] };
    const threshold = opts.threshold ?? DEFAULTS.retrievalThreshold;
    const scored = this.store
      .all()
      .filter((m) => !opts.chatId || !m.chatId || m.chatId === opts.chatId)
      .map((m) => ({ memory: m, relevance: round(clamp01(this.rawScore(m, q)) * m.confidence) }))
      .filter((r) => r.relevance >= threshold)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, opts.topN ?? DEFAULTS.retrievalTopN);
    const now = this.clock();
    for (const r of scored) {
      r.memory.lastAccessed = now;
      r.memory.accessCount += 1;
      this.ledger.log({ memoryId: r.memory.id, action: "read", actor: this.actor, details: { query: text.slice(0, 200), relevance: r.relevance } });
    }
    if (scored.length) this.store.persist();
    const groups = new Map<string, RetrievedMemory[]>();
    for (const r of scored) groups.set(r.memory.domain, [...(groups.get(r.memory.domain) ?? []), r]);
    const context = [...groups.entries()]
      .map(([domain, rs]) => `## ${domain}\n${rs.map((r) => `- [${r.memory.layer}${r.memory.supersededBy ? ", superseded" : ""}] ${r.memory.content}${r.memory.entities.length ? ` (${r.memory.entities.slice(0, 5).join(", ")})` : ""}`).join("\n")}`)
      .join("\n\n");
    return {
      memories: scored,
      context,
      trace: {
        retrievalReason: scored.length ? `${scored.length} memories above ${threshold}` : "nothing relevant remembered",
        strategy: scored.length === 0 ? "minimal" : scored.length > 3 ? "comprehensive" : "personal",
        scores: Object.fromEntries(scored.map((r) => [r.memory.id, r.relevance])),
      },
    };
  }

  feedback(id: string, kind: FeedbackKind): MemoryRecord {
    return this.store.update(
      id,
      (m) => {
        m.confidence = clamp01(m.confidence + FEEDBACK_DELTAS[kind]);
        if (kind === "helpful") m.accessCount += 1;
        if (kind === "wrong" && !m.tags.includes("review")) m.tags.push("review");
      },
      "feedback",
      { kind },
    );
  }
}

// ---------------------------------------------------------------- conflicts

export interface ConflictRecord {
  id: string;
  memoryA: string;
  memoryB: string;
  reason: string;
  confidence: number;
  resolved: boolean;
  resolution?: "keep_a" | "keep_b" | "keep_both" | "merge" | "delete_both";
}

const OPPOSITES: [string, string][] = [["always", "never"], ["enable", "disable"], ["enabled", "disabled"], ["allow", "deny"], ["add", "remove"], ["true", "false"], ["include", "exclude"], ["sync", "async"]];

export class ConflictDetectionService {
  private found: ConflictRecord[] = [];

  constructor(private store: MemoryStoreService, private ledger: TrustLedgerService, private clock: () => number, private actor: string) {}

  scan(): ConflictRecord[] {
    const all = this.store.all();
    const out: ConflictRecord[] = [];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i];
        const b = all[j];
        if (a.supersedes === b.id || b.supersedes === a.id || a.supersededBy === b.id || b.supersededBy === a.id) continue;
        const ta = new Set(tokenize(a.content));
        const tb = new Set(tokenize(b.content));
        const pair = OPPOSITES.find(([x, y]) => (ta.has(x) && tb.has(y)) || (ta.has(y) && tb.has(x)));
        const rest = (t: Set<string>) => [...t].filter((w) => !OPPOSITES.some(([x, y]) => w === x || w === y));
        const similarity = jaccard(rest(ta), rest(tb));
        const numsA = a.content.match(/\b\d+(\.\d+)?\b/g) ?? [];
        const numsB = b.content.match(/\b\d+(\.\d+)?\b/g) ?? [];
        const numeric = similarity > 0.6 && numsA.length > 0 && numsB.length > 0 && numsA.join() !== numsB.join();
        if (!(pair && similarity > 0.5) && !numeric) continue;
        let confidence = 0.5 + similarity * 0.3;
        if (jaccard(a.entities, b.entities) > 0) confidence += 0.1;
        if (a.domain === b.domain) confidence += 0.05;
        if (a.relatedTo.includes(b.id)) confidence -= 0.05;
        const c: ConflictRecord = {
          id: `conf-${randomUUID().slice(0, 8)}`, memoryA: a.id, memoryB: b.id,
          reason: pair ? `opposing terms "${pair[0]}"/"${pair[1]}" on similar content` : `different numbers on similar content (${numsA.join(",")} vs ${numsB.join(",")})`,
          confidence: round(clamp01(confidence)), resolved: false,
        };
        out.push(c);
        this.ledger.log({ memoryId: a.id, action: "conflict_detected", actor: this.actor, details: { conflictId: c.id, with: b.id, reason: c.reason } });
      }
    }
    this.found = out;
    return out;
  }

  /** Weighted decision; resolves only when confident enough, otherwise queues for a person. */
  autoResolve(c: ConflictRecord): "resolved" | "queued" {
    const a = this.store.get(c.memoryA);
    const b = this.store.get(c.memoryB);
    if (!a || !b) return "queued";
    const weight = (m: MemoryRecord) =>
      0.4 * m.confidence + 0.2 * (m.timestamp >= Math.max(a.timestamp, b.timestamp) ? 1 : 0) + 0.1 * Math.min(1, m.accessCount / 10) +
      0.1 * Math.min(1, m.content.length / 200) + 0.2 * (m.provenance.origin === "user_correction" ? 1 : 0);
    const wa = weight(a);
    const wb = weight(b);
    const decision = clamp01(0.5 + Math.abs(wa - wb) + (c.confidence - 0.5) * 0.5);
    if (decision < DEFAULTS.conflictAutoResolveGate) return "queued";
    const [winner, loser] = wa >= wb ? [a, b] : [b, a];
    this.resolve(c, winner.id === a.id ? "keep_a" : "keep_b", { decision: round(decision), winner: winner.id });
    return "resolved";
  }

  /** The losing record is marked superseded, never deleted. */
  resolve(c: ConflictRecord, resolution: ConflictRecord["resolution"], details: Record<string, unknown> = {}): void {
    const [winner, loser] = resolution === "keep_b" ? [c.memoryB, c.memoryA] : [c.memoryA, c.memoryB];
    if (resolution === "keep_a" || resolution === "keep_b") {
      this.store.update(loser, (m) => { m.supersededBy = winner; }, "conflict_resolved", { conflictId: c.id, resolution, ...details });
    } else {
      this.ledger.log({ memoryId: c.memoryA, action: "conflict_resolved", actor: this.actor, details: { conflictId: c.id, resolution, ...details } });
    }
    c.resolved = true;
    c.resolution = resolution;
  }

  pending(): ConflictRecord[] {
    return this.found.filter((c) => !c.resolved);
  }
}

// -------------------------------------------------------------------- sleep

export interface SleepPreview {
  toConsolidate: string[];
  toArchive: string[];
  toSynthesize: string[][];
}

export interface SleepReport {
  backupId: string;
  consolidated: number;
  archived: number;
  synthesized: number;
  actionLog: string[];
}

export class SleepCycleService {
  constructor(private store: MemoryStoreService, private ledger: TrustLedgerService, private clock: () => number, private actor: string) {}

  /** Reads only: nothing changes until execute(). */
  preview(): SleepPreview {
    const now = this.clock();
    const all = this.store.all();
    const referenced = new Set(all.flatMap((m) => [...(m.derivedFrom ?? []), ...(m.supersedes ? [m.supersedes] : []), ...m.relatedTo]));
    const toConsolidate = all
      .filter((m) => m.layer === "short_term" && now - m.lastAccessed >= DEFAULTS.consolidationDays * DAY_MS)
      .map((m) => m.id);
    const toArchive = all
      .filter((m) =>
        now - m.timestamp >= DEFAULTS.archiveMinDays * DAY_MS &&
        m.accessCount <= DEFAULTS.archiveMaxAccess &&
        m.layer !== "long_term" &&
        !referenced.has(m.id) &&
        !m.derivedFrom?.length && // synthesized knowledge is kept
        !m.supersedes && // a current replacement is kept
        m.relatedTo.length < 3) // relationship hubs are kept
      .map((m) => m.id);
    const toSynthesize: string[][] = [];
    const used = new Set<string>();
    for (const m of all) {
      if (used.has(m.id) || m.supersededBy) continue;
      const group = all.filter((o) => o.id !== m.id && !used.has(o.id) && !o.supersededBy && o.domain === m.domain && cosine(m.embedding, o.embedding) >= DEFAULTS.synthesisCosine);
      if (group.length) {
        const ids = [m.id, ...group.map((g) => g.id)];
        ids.forEach((id) => used.add(id));
        toSynthesize.push(ids);
      }
    }
    return { toConsolidate, toArchive, toSynthesize };
  }

  execute(plan: SleepPreview = this.preview()): SleepReport {
    const backupId = this.store.backup();
    const actionLog: string[] = [];
    for (const id of plan.toConsolidate) {
      if (!this.store.get(id)) continue;
      this.store.update(id, (m) => { m.layer = "long_term"; }, "sleep_consolidate");
      actionLog.push(`consolidated ${id}`);
    }
    for (const id of plan.toArchive) {
      if (!this.store.get(id)) continue;
      this.store.delete(id, "sleep_archive");
      actionLog.push(`archived ${id}`);
    }
    let synthesized = 0;
    for (const group of plan.toSynthesize) {
      const members = group.map((id) => this.store.get(id)).filter((m): m is MemoryRecord => !!m);
      if (members.length < 2) continue;
      const best = [...members].sort((a, b) => b.confidence - a.confidence)[0];
      const merged = this.store.add({
        content: best.content, source: "sleep_synthesis", type: best.type, layer: "long_term",
        confidence: Math.max(...members.map((m) => m.confidence)),
        tags: [...new Set(members.flatMap((m) => m.tags))], entities: [...new Set(members.flatMap((m) => m.entities))],
        domain: best.domain, namespace: best.namespace, derivedFrom: members.map((m) => m.id),
        provenance: { origin: "sleep_synthesis", label: `merged ${members.length} similar memories`, refs: [...new Set(members.flatMap((m) => m.provenance.refs ?? []))] },
      });
      this.ledger.log({ memoryId: merged.id, action: "sleep_synthesize", actor: this.actor, details: { from: members.map((m) => m.id) } });
      for (const m of members) this.store.delete(m.id, "merge", { into: merged.id });
      synthesized++;
      actionLog.push(`synthesized ${members.length} into ${merged.id}`);
    }
    return { backupId, consolidated: plan.toConsolidate.length, archived: plan.toArchive.length, synthesized, actionLog };
  }
}

// ----------------------------------------------------------------- dreaming

export interface DreamProposal {
  id: string;
  type: "insight" | "domain" | "invariant";
  content: string;
  derivedFrom: string[];
  suggestedDomain?: string;
  status: "proposed" | "approved" | "rejected";
}

export class DreamingService {
  private proposals = new Map<string, DreamProposal>();

  constructor(private store: MemoryStoreService, private ledger: TrustLedgerService, private clock: () => number, private actor: string) {}

  private related(a: MemoryRecord, b: MemoryRecord): number {
    return (
      0.45 * Math.max(0, cosine(a.embedding, b.embedding)) + 0.15 * jaccard(a.tags, b.tags) +
      0.25 * (a.domain === b.domain && a.type === b.type ? 1 : 0) + 0.15 * jaccard(a.entities, b.entities)
    );
  }

  /** Proposes, never writes: proposals become memories only through approve(). */
  dream(): DreamProposal[] {
    const all = this.store.all().filter((m) => !m.supersededBy);
    const clusters: MemoryRecord[][] = [];
    const used = new Set<string>();
    for (const m of all) {
      if (used.has(m.id)) continue;
      const cluster = [m, ...all.filter((o) => o.id !== m.id && !used.has(o.id) && this.related(m, o) >= DEFAULTS.dreamRelatedness)];
      if (cluster.length >= DEFAULTS.dreamClusterMinSize) {
        cluster.forEach((c) => used.add(c.id));
        clusters.push(cluster);
      }
    }
    const out: DreamProposal[] = [];
    const push = (p: Omit<DreamProposal, "id" | "status">) => {
      if (out.filter((x) => x.type === p.type).length >= DEFAULTS.maxDreamProposalsPerType) return;
      const proposal: DreamProposal = { ...p, id: `dream-${randomUUID().slice(0, 8)}`, status: "proposed" };
      out.push(proposal);
      this.proposals.set(proposal.id, proposal);
      this.ledger.log({ memoryId: proposal.id, action: "dream_proposed", actor: this.actor, details: { type: p.type, derivedFrom: p.derivedFrom } });
    };
    for (const c of clusters) {
      const preferences = c.filter((m) => m.type === "preference" || m.type === "personal" || m.tags.includes("correction"));
      if (preferences.length >= 2) {
        push({ type: "invariant", content: `Consistent pattern: ${preferences.map((m) => m.content).join("; ")}`, derivedFrom: preferences.map((m) => m.id) });
      } else {
        const entities = [...new Set(c.flatMap((m) => m.entities))].slice(0, 5);
        push({ type: "insight", content: `Related findings${entities.length ? ` about ${entities.join(", ")}` : ""}: ${c.map((m) => m.content).join(" ")}`, derivedFrom: c.map((m) => m.id) });
      }
    }
    for (const m of all.filter((x) => x.domain === "general" && x.entities.length)) {
      push({ type: "domain", content: `Move to domain ${m.entities[0]}`, derivedFrom: [m.id], suggestedDomain: m.entities[0] });
    }
    return out;
  }

  approve(id: string): MemoryRecord | undefined {
    const p = this.proposals.get(id);
    if (!p || p.status !== "proposed") return undefined;
    p.status = "approved";
    this.ledger.log({ memoryId: p.id, action: "dream_approved", actor: this.actor });
    if (p.type === "domain") {
      for (const mid of p.derivedFrom) this.store.update(mid, (m) => { m.domain = p.suggestedDomain ?? m.domain; }, "update", { dream: p.id });
      return undefined;
    }
    const sources = p.derivedFrom.map((mid) => this.store.get(mid)).filter((m): m is MemoryRecord => !!m);
    return this.store.add({
      content: p.content, source: "dreaming", layer: "long_term", type: p.type === "invariant" ? "preference" : "factual",
      confidence: sources.length ? Math.min(...sources.map((m) => m.confidence)) : 0.6, derivedFrom: p.derivedFrom,
      domain: sources[0]?.domain, namespace: sources[0]?.namespace,
      provenance: { origin: "dream", label: `approved ${p.type} proposal`, refs: [...new Set(sources.flatMap((m) => m.provenance.refs ?? []))] },
    });
  }

  reject(id: string): void {
    const p = this.proposals.get(id);
    if (!p) return;
    p.status = "rejected";
    this.ledger.log({ memoryId: p.id, action: "dream_rejected", actor: this.actor });
  }
}

// ------------------------------------------------------------------- facade

export interface HMEMOptions {
  clock?: () => number;
  /** When set, memories live in state.json and the ledger in ledger.jsonl here. */
  persistDir?: string;
  actor?: string;
}

export class HMEM {
  readonly ledger: TrustLedgerService;
  readonly store: MemoryStoreService;
  readonly retrieval: MemoryRetrievalService;
  readonly conflicts: ConflictDetectionService;
  readonly sleep: SleepCycleService;
  readonly dreaming: DreamingService;
  readonly clock: () => number;

  constructor(opts: HMEMOptions = {}) {
    this.clock = opts.clock ?? Date.now;
    const actor = opts.actor ?? "cartograph";
    if (opts.persistDir) mkdirSync(opts.persistDir, { recursive: true });
    const file = (name: string) => (opts.persistDir ? path.join(opts.persistDir, name) : undefined);
    this.ledger = new TrustLedgerService(this.clock, file("ledger.jsonl"));
    this.store = new MemoryStoreService(this.clock, this.ledger, actor, file("state.json"));
    this.retrieval = new MemoryRetrievalService(this.store, this.ledger, this.clock, actor);
    this.conflicts = new ConflictDetectionService(this.store, this.ledger, this.clock, actor);
    this.sleep = new SleepCycleService(this.store, this.ledger, this.clock, actor);
    this.dreaming = new DreamingService(this.store, this.ledger, this.clock, actor);
  }

  add(input: AddInput): MemoryRecord {
    return this.store.add(input);
  }

  query(text: string, opts?: Parameters<MemoryRetrievalService["query"]>[1]): QueryResult {
    return this.retrieval.query(text, opts);
  }

  feedback(memoryId: string, kind: FeedbackKind): MemoryRecord {
    return this.retrieval.feedback(memoryId, kind);
  }
}
