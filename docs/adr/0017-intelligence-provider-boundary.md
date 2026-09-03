# ADR 0017: Design Intelligence provider boundary

- **Status:** Accepted (amended 2026-09-03)
- **Date:** 2026-08-14

## Context

The Design Agent Kernel (`intent → decide → paint → observe → review → settle`) is open infrastructure. Higher-level design assistance (research, multi-candidate planning, advanced review, and similar) runs through one client so Kernel nodes stay decoupled from floor implementations.

## Decision

1. **Kernel stays in-tree and open.** Runtime graph, Scene, Skill SDK surfaces, basic Observe/QA, and basic Review merge remain part of this repository.

2. **Single entry:** `packages/intelligence-client` exposes `DesignIntelligenceClient` and an `IntelligenceProvider` protocol. Design Runtime calls the client only. Shared method names / lane / hop contracts live in `packages/protocol`.

3. **Provider:** Runtime always uses in-process `BasicLocalProvider` (deterministic / rule-based floors shipped with the API). No separate Intelligence HTTP service.

4. **Everything in this monorepo is open source.** Vision tools use documented third-party APIs (MediaKit, WaveSpeed, Seedream, …). Mockup is FE-only under `apps/web/src/components/editor/nodes/ImageNode/mockup/`.

## Consequences

### Positive

- One clone → run path; no dual private/public trees or strip pipeline.
- Kernel / protocol / BasicLocal evolve in the same open repo.

### Negative / trade-offs

- Advanced floors that need private model stacks must be contributed as open providers or called as ordinary external APIs — not as a closed sibling service.

## Alternatives considered

1. **Hard-fork Kernel for “pro” features** — rejected; breaks one SceneDocument / one graph story.
2. **Separate closed Intelligence HTTP service** — rejected; removed from the tree.
3. **Git submodule for closed code** — rejected; the product is fully open.

## References

- `packages/intelligence-client`
- `packages/protocol`
- `docs/adr/0001-monorepo-boundaries.md`
- CONTRIBUTING — “Design agent floors”
