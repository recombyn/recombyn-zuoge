# ADR 0023: Public vs private Design Agent eval

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

Design quality regression needs an open suite anyone can run, while human
rankings, proprietary judge weights, and closed before/after corpora must never
enter the Apache-2.0 git history or Public CI artifacts.

## Decision

1. **Public layout (this monorepo):**
   - `packages/eval-framework` — compare helpers + skill version lookup
   - `eval/framework/` — docs pointer to the package
   - `eval/design-agent/` — **the** public suite (tasks, rubric, baseline, runners)
   - `eval/public/` — stable name alias documenting that public suite path
2. **Operator-only eval** (not in this repository):
   - Closed rankings, datasets, and proprietary rubrics
   - Dataset files are gitignored in the operator environment; only README + placeholders may be committed in private forks
3. **CI rule:** Public workflows may only read `eval/design-agent/**` and
   `packages/eval-framework/**`. They must not upload or clone private-eval
   corpora into Public artifacts.
4. **Docs rule:** Public docs describe the open suite and compare gates only —
   not private ranking methodology or closed corpora contents.

## Consequences

- Clone → run → compare works without Intelligence Cloud.
- Operators keep closed eval data in the private repo (or private storage).
- Renaming `eval/design-agent` → `eval/public/design-agent` is optional later;
  the alias README avoids a breaking path move now.

## References

- `eval/README.md`
- `packages/eval-framework`
- [ADR 0017](./0017-intelligence-provider-boundary.md)
