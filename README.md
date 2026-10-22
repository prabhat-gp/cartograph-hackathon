# Cartograph

**Google Maps for your codebase.** Paste a GitHub repo: Cartograph's agents (Scout → parallel Readers → Cartographer, plus a Reviewer for drift and a Tracer for questions) read the code and draw its architecture, every dependency cited from a real `file:line` (no citation, no arrow). Request flows animate hop by hop, and every push is reviewed for architecture drift.

```sh
npm install
npm run build:web
npm start                 # http://localhost:8787/app (PORT)
```

**The agent that can explain why.** Ask Cartograph why a piece of code is the way it is, and it answers with the evidence chain behind it: the code (`file:line`), the commit that introduced it, the pull request that reviewed it, and the issue that asked for it.

Built for the Open Agent Hackathon 2026, Track 02 "The Agent That Can Explain Why".

## Stack

| Part | Role |
|---|---|
| NVIDIA Nemotron | The models behind every agent |
| Meterless Nightshift | Primary AI provider (OpenAI-compatible local runtime) |
| Meterless H-MEM | Memory with provenance for evidence and past answers |
| Zetaris | Data layer: GitHub history and the code map, queried with SQL |
| Cursor | Development environment |

## Setup

```bash
npm install
cp .env.example .env   # then fill in the keys
npm run typecheck
npm test
npm run sponsors       # live status of NVIDIA, Meterless and Zetaris
```

## How the sponsors fit

**Meterless Runtime is the primary AI provider.** Every agent call goes to Nightshift's OpenAI-compatible API (`http://127.0.0.1:8088/v1`) with its access token, `meterless-app: cartograph` and `meterless-scope: user`. Agents ask for a tier (`fast` or `deep`) and the runtime's modes (`meterless/fast`, `meterless/deep`) pick the model. Runtime health follows the contract: `GET /v1/models` decides online, unauthorized or offline. Connect links (`http://host:port/connect#k=…`) are supported.

**NVIDIA Nemotron runs every agent.** Through Nightshift, or directly through `build.nvidia.com` when the runtime can't be reached (only then: a runtime that answers with an error keeps its answer). NVIDIA's strict JSON-schema mode runs away into whitespace, so the client asks for a JSON object, validates it against the schema, and gives the model one repair turn with the exact error.

**Zetaris holds the evidence.** `npm run ingest -- owner/name` reads a repository's git history, `git blame` at head, and its merged pull requests with their linked issues and review discussion into a Postgres evidence store. Zetaris reads that store as a JDBC datasource, and `npm run zetaris:setup` models it as the `provenance` Unified Semantic Layer (`lightning.metastore.cartograph.provenance`): repositories, files, line origins, code changes, pull requests, issues and discussion, with keys and relationships so one query can walk from a line of code to the commit, pull request and issue behind it. Two data-quality rules measure how explainable a codebase is: `has_review_trail` (a change was merged through a pull request) and `states_a_reason` (a pull request links an issue or explains itself).

**Meterless H-MEM remembers with provenance.** Planned: evidence and past answers stored with their source, with a trust ledger.

`metadata.json` tracks each integration's status, code and evidence.

## Usage and budget

The free NVIDIA tier shows no credit balance, so every model call is logged to `.cartograph/usage.jsonl` and calls stop before daily caps (`CARTOGRAPH_MAX_CALLS_PER_DAY`, `CARTOGRAPH_MAX_TOKENS_PER_DAY`, `CARTOGRAPH_MAX_CALLS_PER_MINUTE`). `npm run usage` prints spend per day and per model.

## Status

Work in progress during the build window (22–27 October 2026).
