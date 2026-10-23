# Meterless H-MEM conformance suite (vendored)

Copied unchanged from [Meterless/Meterless](https://github.com/Meterless/Meterless), `engines/hmem/conformance` at commit `1742dec56a66e58eef9dda2d2b865823758ca8cd`, under the Apache License 2.0 (see LICENSE). It checks an H-MEM implementation against the spec's exact formulas, deltas and guardrails.

Cartograph runs it against its own implementation in `src/memory/hmem.ts`:

```bash
npm run hmem:conformance
```
