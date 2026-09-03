# ADR 0023: Design Agent eval suite

- **Status:** Accepted (amended 2026-09-03)
- **Date:** 2026-08-14

## Context

Design quality regression needs a suite anyone can clone and run. This
repository is fully open source — eval fixtures live in-tree under `eval/`.

## Decision

1. **Layout:**
   - `packages/eval-framework` — compare helpers + skill version lookup
   - `eval/framework/` — docs pointer to the package
   - `eval/design-agent/` — public suite (tasks, rubric, baseline, runners)
   - `eval/public/` — alias documenting that suite path
2. **CI:** Workflows may read `eval/design-agent/**` and
   `packages/eval-framework/**`.
3. **No private-eval tree.** Operator-specific corpora stay outside this repo
   if needed; they are not part of the product source.

## Consequences

- Clone → run → compare works without extra services.
- Renaming `eval/design-agent` → `eval/public/design-agent` remains optional;
  the alias README avoids a breaking path move.

## References

- `eval/README.md`
- `packages/eval-framework`
- [ADR 0017](./0017-intelligence-provider-boundary.md)
