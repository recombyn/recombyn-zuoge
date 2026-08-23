# ADR 0017: Design Intelligence provider boundary

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

The Design Agent Kernel (`intent → decide → paint → observe → review → settle`) is open infrastructure. Higher-level design assistance (research, multi-candidate planning, advanced review, and similar) should be swappable so:

- Community / self-host installs run useful **local** behavior without proprietary services.
- Operators can plug in an optional remote provider through a single client.
- Contributors do not couple Kernel nodes to any one proprietary stack.

## Decision

1. **Kernel stays in-tree and open.** Runtime graph, Scene, Skill SDK surfaces, basic Observe/QA, and basic Review merge remain part of this repository.

2. **Single public entry:** `packages/intelligence-client` exposes `DesignIntelligenceClient` and an `IntelligenceProvider` protocol. Design Runtime calls the client only — not ad-hoc imports of advanced engines. Shared method names / lane / hop contracts live in `packages/protocol`.

3. **Default provider:** `BasicLocalProvider` (shipped with the API) implements the protocol with deterministic / rule-based behavior already available in this monorepo. No network call required.

4. **Optional remote provider:** Config may point the client at an HTTP-compatible `IntelligenceProvider`. This repository documents **the protocol and config knobs only**. It does not document, vendor, or mirror any proprietary provider’s internals, datasets, prompts, or service topology.

5. **Open by default for infrastructure.** Protocols, schemas, SDKs, canvas, foundation skills (methodology + public examples), eval *framework*, and public fixtures stay open.

6. **Documentation rule (public repo):** Do not describe proprietary intelligence implementations, private datasets, private prompts, model weights, or closed service layouts in ADRs, README, CONTRIBUTING, or other public docs. Point third parties at the **provider interface** if they want to build their own.

## Consequences

### Positive

- Clear contribution boundary: improve Kernel / protocol / BasicLocal here; proprietary stacks stay out of public docs and git history.
- Self-host path remains clone → run without a commercial account.
- Future package splits (`protocol`, `skill-sdk`, …) can grow behind the same client.

### Negative / trade-offs

- Advanced behavior quality differs between BasicLocal and an operator-supplied remote provider.
- Provider extraction is incremental; some advanced logic may still live behind BasicLocal until fully swapped.

## Alternatives considered

1. **Hard-fork Kernel for “pro” features** — rejected; breaks one SceneDocument / one graph story.
2. **Document proprietary services inside this repo** — rejected; leaks closed surface area into the open reference.
3. **Git submodule for closed code** — rejected; contaminates public clone and release boundary.

## References

- `packages/intelligence-client`
- `packages/protocol`
- `docs/adr/0001-monorepo-boundaries.md`
- CONTRIBUTING — “Intelligence providers”
