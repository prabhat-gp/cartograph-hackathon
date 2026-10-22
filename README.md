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
```

## Status

Work in progress during the build window (22–27 October 2026).
