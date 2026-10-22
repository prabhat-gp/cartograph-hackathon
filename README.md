# Cartograph

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

**Zetaris holds the evidence.** GitHub history and the code map are tables Cartograph queries with Lightning SQL over Zetaris's REST API.

**Meterless H-MEM remembers with provenance.** Planned: evidence and past answers stored with their source, with a trust ledger.

`metadata.json` tracks each integration's status, code and evidence.

## Usage and budget

The free NVIDIA tier shows no credit balance, so every model call is logged to `.cartograph/usage.jsonl` and calls stop before daily caps (`CARTOGRAPH_MAX_CALLS_PER_DAY`, `CARTOGRAPH_MAX_TOKENS_PER_DAY`, `CARTOGRAPH_MAX_CALLS_PER_MINUTE`). `npm run usage` prints spend per day and per model.

## Status

Work in progress during the build window (22–27 October 2026).
