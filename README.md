# Cartograph

**Google Maps for your codebase.** Paste a GitHub repo. Cartograph's agents read the code and draw it as a map: the parts of the system and the arrows between them, each arrow cited to the `file:line` that proves it. Click an arrow and ask *why* it exists: the agents follow that line to the commit, the pull request and the issue behind it, and explain the decision in plain English.

Built for the Open Agent Hackathon 2026, Track 02 "The Agent That Can Explain Why".

## What you can do

| | What it answers |
|---|---|
| **Map** a repo | What is this built from, and what talks to what? |
| **Click an arrow** | Where in the code is this connection? (`file:line`, quoted) |
| **Find out why** | Why was it built this way? (line → commit → pull request → issue, every claim checked) |
| **What breaks?** on a part | Which parts and flows depend on it? |
| **Flows** | How does one request travel through the system, step by step? |
| **Drift** | What did the last push change in the architecture? |
| **Why-coverage** | Which arrows have a stated reason, and which were never reviewed? |
| **Tour** | A one-minute walk through the desk, built from whichever map is open |

## Try it in one minute, no keys

```sh
docker build -t cartograph .
docker run -p 8787:8787 -e SAMPLE_MODE=true cartograph
curl -s localhost:8787/run                                    # the three examples
curl -s -X POST localhost:8787/run -H 'content-type: application/json' -d '{"example": "02-google-oauth"}'
```

Without Docker: `npm install && npm run sample` replays all three and checks each answer against the live one.

`SAMPLE_MODE=true` runs the real explain agents (Planner → Investigator → Writer ↔ Critic, plus H-MEM) on recorded data: what Zetaris returned for each query and what each model answered when the example ran live (`samples/`). The agent logic, citation checks and the Critic's revision loop all run again; only the network calls are replayed.

| | |
|---|---|
| `input_examples/` | three real questions, each about an arrow on the PrepPilot map |
| `output_examples/` | the live answers: one approved with high confidence, two the Critic sent back and still didn't approve |
| `logs/trace-*.jsonl` | the live runs' traces: every agent, handoff, critique and retry |
| `POST /run` | `{"repo", "question", "path"?, "line"?}` runs live; `{"example": "<id>"}` replays in sample mode |

## Run it

```sh
npm install && npm --prefix site install
cp .env.example .env      # NVIDIA key, Zetaris login, evidence-store URL
npm run build             # the map desk (Vite) and the landing page (Next.js)
npm start                 # http://localhost:8787: landing page at /, map desk at /app
npm test                  # every integration is tested against mocks; no keys needed
npm run sponsors          # live status of Meterless, NVIDIA and Zetaris
```

| Part | Stack | Where |
|---|---|---|
| Landing page | Next.js + Tailwind, exported as static files | `site/` |
| Map desk | React + Tailwind, built by Vite into one HTML file (chat hosts render it inline over MCP) | `src/web/` |
| Server, agents, MCP | Node + Express | `src/server/`, `src/agent/`, `src/llm/` |
| Hosting | One server: Caddy (HTTPS) → Cartograph, next to Zetaris and Postgres | `deploy/` |

## The agents

**Mapping** (`src/server/brain/`): a **Scout** plans which files matter, **Readers** read them in parallel and report parts and dependencies with quoted evidence, a **Cartographer** merges them into one map with flows, and a **Verifier** drops every dependency whose quote isn't in the code at that line. No citation, no arrow. A **Reviewer** re-checks the map on every push (drift), and a **Tracer** answers questions on the map.

**Explaining** (`src/agent/`): a **Planner** (skipped when the question comes from an arrow, whose line is already known), an **Investigator** that queries the history in Zetaris, a **Writer** that drafts an answer citing evidence ids, and a **Critic** that checks every claim against its evidence and can send the Investigator back for more (one revision). Every step is written to a trace the desk shows under each answer.

## Sponsor technology

### NVIDIA Nemotron: every agent
Two tiers: `nemotron-3-ultra-550b-a55b` for planning, merging, reviewing and critique; `nemotron-3.5-lightning-30b-a3b` for reading files, tracing and writing answers. NVIDIA's strict JSON-schema mode runs away into whitespace, so the client (`src/llm/client.ts`) asks for a JSON object, validates it with zod, salvages partial output, and gives the model one repair turn with the exact error. Calls that hang in the provider's queue are cut short and retried.

### Meterless
- **Build: the H-MEM engine** (`src/memory/hmem.ts`) in a working feature. Every answer the Critic approves is remembered with its sources (`src/memory/findings.ts`). The next question about the same code starts from those findings, findings about lines that have since changed are set aside as stale, and the Helpful / Not helpful / Wrong buttons under each answer feed H-MEM's trust ledger. `npm run hmem:conformance` passes the Meterless conformance suite (`third_party/meterless-hmem-conformance`).
- **Power: Meterless Runtime as the primary AI provider** (`src/meterless/runtime.ts`, `src/config.ts`). With a Runtime token set, every agent call goes to Nightshift's OpenAI-compatible API (Runtime 1.4: bearer token, `meterless-app` and `meterless-scope` headers, `meterless/fast` and `meterless/deep` modes, `GET /v1/models` health, connect links). NVIDIA is called directly only when the runtime can't be reached. Nightshift has no build for the hosted server (x86 Linux) or for our Intel Mac, so the hosted demo calls NVIDIA directly, as the Meterless team confirmed is allowed. The desk's **Powered by** panel shows the live state of each integration.

### Zetaris: the history as a Unified Semantic Layer

**Build.** `npm run ingest -- owner/name` reads a repository's git history, `git blame` for the lines the map cites, and its merged pull requests with linked issues and review discussion (GitHub GraphQL) into a Postgres evidence store (`sql/postgres/`). The desk does the same on demand the first time you ask why about a map. Zetaris reads that store as a JDBC datasource, and `npm run zetaris:setup` compiles it into the `provenance` USL (`sql/zetaris/provenance_usl.sql`, deployed at `lightning.metastore.cartograph.provenance`): `repository`, `source_file`, `code_change`, `file_change`, `line_origin`, `pull_request`, `issue`, `pr_issue` and `discussion`, with primary and foreign keys so one query can walk from a line to the commit, pull request and issue behind it. Two data-quality rules (`sql/zetaris/dq_rules.sql`) score how explainable a codebase is: `has_review_trail` (a change was merged through a pull request) and `states_a_reason` (a pull request links an issue or explains itself in its description). The Investigator and Why-coverage query the USL live (`src/agent/evidence.ts`).

**Reflection.**
- *How it saved time.* The answer to "why does this line exist?" is spread across git objects, blame output and three kinds of GitHub records. Without the USL, every agent question would need its own code to join them. With it, the Investigator asks plain SQL: the line-to-commit-to-PR walk is a two-table join, and Why-coverage for a whole map is one query. When we added discussion comments, we added a table and its key, not new join code in every agent.
- *How it helps the work.* The DQ rules turned "is this codebase explainable?" into a number. On expressjs/express, 19% of the lines we traced lead to a pull request that states a reason; on ky, 13% of the map's arrows do. That tells a new engineer which parts to ask about before touching them, and tells a team where its knowledge lives only in people's heads.
- *How Zetaris could improve.* An API key on the local bundle can be refused ("Not Allowed"), so Cartograph falls back to the console login; `CACHE TABLE` doesn't survive a restart; and the managed cloud couldn't verify our AWS account (the new account type). A documented, stable REST path for a local install would remove most of that friction.

## AI and model usage

- **Models:** NVIDIA Nemotron only (see above), through Meterless Runtime when it runs and NVIDIA's API otherwise.
- **What the models see:** file contents, commit messages, pull requests, issues and comments of the repository being mapped, all marked as untrusted data in every prompt.
- **Grounding:** the Verifier drops arrows whose quote isn't in the code; the Critic rejects claims their evidence doesn't support; unsupported citations are removed before an answer is shown.
- **Budget:** the free NVIDIA tier shows no credit balance, so every call is logged to `.cartograph/usage.jsonl` and calls stop before daily caps (`CARTOGRAPH_MAX_CALLS_PER_DAY`, `CARTOGRAPH_MAX_TOKENS_PER_DAY`, `CARTOGRAPH_MAX_CALLS_PER_MINUTE`, `CARTOGRAPH_MAX_MAPS_PER_DAY`). `npm run usage` prints spend per day and model. Approved answers are reused for the same arrow at the same commit.
- **Development:** built with Claude Code.

## Hosting

`deploy/` runs Cartograph on the same server as Zetaris and Postgres, so the app reaches them on localhost. `deploy/setup.sh` installs Node 22 and Caddy (automatic HTTPS) and starts the services. A systemd timer runs `deploy/update.sh` every two minutes: when `main` has moved, it builds the new commit in a fresh release folder, switches over only if the build and type-check pass, and switches back if the new server doesn't come up healthy. Server settings are in `deploy/cartograph.env.example`.

In public mode (`CARTOGRAPH_PUBLIC=1`) visitors may only map public GitHub repositories, each visitor's model-spending actions are limited per hour, and drift comments go only to repositories listed in `CARTOGRAPH_COMMENT_REPOS`. `GET /health?deep=1` checks every integration for an uptime monitor.

## Limitations

- A map takes about 2–6 minutes on NVIDIA's free tier, and a first "why" on a repo adds 20–60 s while its history is loaded.
- "Why" answers are only as good as the history: a line committed without a pull request can be traced to its commit but rarely to a reason, and the answer says so.
- Very large repositories are mapped from the files the Scout picks, not every file.

## Licences

Third-party code: the Meterless H-MEM conformance suite in `third_party/` (its own licence file). Dependencies are listed in `package.json` and `site/package.json`.
