# ADR 0019: Open skill-sdk package

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

Skill pack loading lives in the API `skill_store`, but pack meta normalize / extends /
version parsing are useful outside the monolith (validators, pack authors, future
plugin tooling). Contributors should not invent parallel meta shapes.

## Decision

1. Ship `packages/skill-sdk` (`recombyn_skill_sdk`) with open helpers:
   `normalize_pack_meta`, `parse_extends`, `parse_pack_version`, meta filename constants.
2. API `pack_io` imports those helpers (no behavior change).
3. Full disk load, skill graph, and prompt assembly stay in the API skill_store.

## Consequences

- Pack authors can validate meta without booting the API.
- Further skill tooling can grow in-package; do not add one-off `*Utils` modules for a single consumer.

## References

- `packages/skill-sdk`
- [ADR 0018](./0018-public-skills-catalog.md)
- [ADR 0013](./0013-skill-extensions.md)
