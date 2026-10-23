# Cartograph brain: implementation spec

Cartograph turns a code repository into a verified architecture graph and keeps it
current on every push. This folder (`src/server/brain/`) is the **agent pipeline**.
Everything outside it (git access, evidence verification, storage, MCP server, UI)
already exists or is being written separately. **Only create or edit files inside
`src/server/brain/` and `test/brain*.test.ts`.**

## Contract

`types.ts` is the contract. Do not change it. `index.ts` must export:

```ts
export const brain: Brain;  // and also the three functions as named exports
export async function mapRepository(snapshot: RepoSnapshot, opts?: BrainOptions): Promise<DraftGraph>;
export async function reviewChanges(input: ReviewInput, opts?: BrainOptions): Promise<ReviewResult>;
export async function traceQuestion(input: TraceInput, opts?: BrainOptions): Promise<TraceResult>;
```

Data types: `src/shared/graph.ts` (`CartographNode`, `CartographEdge`, `CartographFlow`, `NODE_KINDS`,
`EDGE_KINDS`, …) and `src/server/repo.ts` (`RepoSnapshot`, `RepoFile`, `ChangedFile`,
`numberLines()`).

Edge direction is always **actor → dependency**: frontend → api (http), api → database
(sql), api → queue (publish), worker → queue (consume), service → external (sdk),
external → api (webhook, e.g. a payment provider calling our webhook route).

## Stack

- Every agent call goes through `runAgent` in `run.ts`, which calls `callJson` in
  `src/llm/client.ts`: NVIDIA Nemotron, through Meterless Nightshift when
  `METERLESS_API_KEY` is set and NVIDIA's API directly otherwise.
- `zod` v4 schemas describe each agent's output. The client puts the JSON Schema in the
  prompt, asks for a JSON object, validates the answer and gives the model one repair
  turn with the exact validation error (NVIDIA's strict json_schema mode is not used:
  it runs away into whitespace). Use `.nullable()` instead of `.optional()`.
- Tiers: readers and the tracer use the fast tier (Nemotron 3.5 Lightning), scout,
  cartographer and reviewer the deep tier (Nemotron 3 Ultra). `opts.model` overrides.
- Every call is logged to the usage ledger with its tokens; daily caps protect the
  free NVIDIA quota.
- No other new dependencies.

## mapRepository(snapshot): the multi-agent pipeline

Report progress with `opts.onProgress` at every step (start/done of each agent, plus
interesting counts). These messages are shown live in the UI, so make them short and
concrete, e.g. `"Scout · found Next.js, Express, Postgres, Redis"`,
`"Reader 2/4 · api/routes · 9 dependencies"`, `"Cartographer · 16 components, 4 flows"`.

1. **Scout** (one call). Input: repo name, the full file tree (`snapshot.tree`, capped at
   ~2,500 paths), and the full contents of manifests/config (package.json files,
   docker-compose, Dockerfile, .env.example, prisma/schema, README first 120 lines).
   Output:
   - `stack: string[]`, `summary: string` (2 sentences: what the system does)
   - `components`: the **architecture-level** building blocks, 6–20 of them:
     `{ id (kebab-case), kind (NODE_KINDS), label, tech (nullable), summary, paths: string[] }`.
     `paths` lists the files or directories that implement it (empty for databases,
     caches, queues and external services). Group route handlers by resource
     (`orders-api`, not one node per endpoint). Always include the data stores, queues
     and third-party services the code talks to, plus a `browser` client when there is
     a frontend.
   - `readerGroups`: 2–6 groups of `{ name, focus, files: string[] }` that together cover
     every file that matters, each group up to ~60k tokens (use `RepoFile.tokens`).
   - `flowHints: string[]`: 3–6 important user journeys to trace.
   If the Scout call fails, fall back to grouping files by top-level directory.

2. **Readers** (one per group, run in parallel with a concurrency limit of 4). Input:
   the component catalog plus every file in the group rendered with
   `numberLines()` under a `=== path ===` header. Output:
   - `edges`: `{ from, to, kind (EDGE_KINDS), label, evidence: [{ path, line, snippet }] }`.
     `from`/`to` must be component ids from the catalog or from `newComponents`.
     The **snippet must be copied verbatim from ONE line** of the given code (without the
     line-number prefix), and `line` is that line's number. Every edge needs at least
     one evidence item. Labels are short and specific: `"POST /api/orders"`,
     `"INSERT INTO orders"`, `"enqueue order.created"`, `"razorpay.orders.create"`.
   - `newComponents`: components the catalog missed (same shape as the Scout's).
   - `componentNotes`: `{ id, details: string[] }`: endpoints, tables, queue names, etc.
   A reader that fails after one retry is skipped (report an error progress event);
   the pipeline continues.

3. **Cartographer** (one call). Input: the catalog, all reader edges **numbered
   globally** (`r1`, `r2`, …) with from/to/kind/label, and the notes. **Do not send code
   or evidence.** Output:
   - `nodes`: the final component list (merge duplicates, fix kinds, write summaries,
     fold details in). 6–24 nodes.
   - `edges`: `{ id ("e1", "e2", …), from, to, kind, label, sources: ["r3", "r7"] }`: one
     per distinct dependency, merging reader edges that describe the same thing.
   - `flows`: 3–6 `{ id (kebab-case), name, trigger, description, steps: [{ edge, note }] }`
     where `edge` is an `e*` id and steps are in execution order (a request travelling
     hop by hop). Notes are one short sentence each.
   - `summary`, `stack`.
   Then, **in code**, build each final edge's `evidence` by concatenating the evidence
   of its `sources` reader edges (dedupe by path+line). Drop edges whose sources don't
   resolve. If an edge's from/to isn't a node, drop it. Do not let the model rewrite
   evidence.

4. Return the `DraftGraph`, with `agentStats` holding one entry per agent call:
   `{ agent: "scout" | "reader:<group>" | "cartographer", durationMs, inputTokens, outputTokens }`
   (take usage from the run result when available).

**Budget.** If the files in reader groups total more than ~350k tokens, keep the
highest-value files (entry points, routes, services, workers, db/config) and skip the
rest, with a progress event saying how many were skipped.

## reviewChanges({ graph, snapshot, changes }): the drift reviewer

One **Reviewer** agent call. Input: a compact version of the existing graph (nodes:
id/kind/label/summary/files; edges: id/from/to/kind/label/evidence paths; no flows'
notes), and for each changed file its status, its unified diff (`patch`), and, for
added/modified files, the full new content via `numberLines()` (cap ~40k tokens
total). Output:
- `addNodes`: new components the change introduces (new ids only)
- `addEdges`: new dependencies with evidence from the **new** content of changed files
  (same verbatim-snippet rule), `id` like `"new-1"`
- `removeEdgeIds`: existing edges the change deletes
- `findings`: `{ severity: "info" | "warning" | "critical", title, detail, nodeIds, edgeIds }`,
  written as an experienced architect reviewing the PR: layering violations (frontend
  touching the database), new third-party dependencies, secrets in the client,
  bypassed services, sync calls that used to be async. Return an empty list when nothing
  matters. `edgeIds` may reference new edge ids.
- `summary`: 1–2 sentences.

If `changes` is empty, return an empty result without calling the model.

## traceQuestion({ graph, question }): the tracer

One **Tracer** agent call over the compact graph (nodes, edges, existing flows with
their step edge ids). If an existing flow answers the question, return its `flowId`.
Otherwise compose a new flow whose steps are **existing edge ids** in execution
order, and return it as `flow` (id kebab-case, name, trigger, description, steps with
notes). In code, drop steps whose edge id doesn't exist; if nothing is left, return
`flowId: null, flow: null` with an answer explaining that. Always return a 1–3 sentence
`answer`.

## Engineering requirements

- Keep the code readable and split by agent: `prompts.ts` (instructions),
  `schemas.ts` (zod output schemas), `run.ts` (a small helper that runs an agent with
  one retry, timing, usage capture, abort support), `map.ts`, `review.ts`, `trace.ts`,
  `index.ts`. Pure helpers (grouping fallback, budget, numbering, evidence merging,
  compact graph) go in `util.ts`.
- Unit tests for the pure helpers in `test/brain.util.test.ts` (vitest, no network).
- `npx tsc --noEmit` and `npx vitest run test/brain.util.test.ts` must pass. Tests never
  call a model; use the fixture brain (`CARTOGRAPH_BRAIN=fixture`) for offline runs.
