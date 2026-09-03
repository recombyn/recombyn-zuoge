# ADR 0018: Public skills catalog layout

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

Shipped Design Agent skills lived under `apps/api/seeds/design_skills`. The catalog should match the monorepo shape (`skills/foundation` + `skills/domains`) while keeping operator deploy mounts separate.

## Decision

1. **Canonical shipped roots:**
   - `skills/foundation/` — core craft packs
   - `skills/domains/` — surface / deliverable packs
2. **Self-host / plugin overrides:** `plugins/skills/` (+ `DESIGN_SKILLS_PLUGIN_DIRS`) — later wins on `skill_key`.
3. **`apps/api/seeds/design_skills` is unused** (empty leftover path; not scanned).
4. **Documentation rule:** This repo documents pack layout and methodology.
   Operator-only prompt inventories or routing notes belong under `plugins/skills/`, not in `skills/`.

## Consequences

### Positive

- Matches the monorepo mental model (`skills/foundation` + `skills/domains`).
- Clear place for community PRs to foundation vs domain packs.

### Negative / trade-offs

- Paths in older docs may still say `seeds/design_skills`; point them at `skills/`.

## Alternatives considered

1. **Keep only seeds/** — rejected; fights the agreed catalog tree.
2. **Symlink seeds → skills** — fragile on Windows; prefer real moves + multi-root scan.

## References

- `skills/README.md`
- `docs/adr/0013-skill-extensions.md`
- `app/services/design/prompts/skill_store/pack_io.py`
