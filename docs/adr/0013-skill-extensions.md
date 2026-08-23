# Extensibility — Skill packs (Phase A)

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

We want third-party / private-deploy **extensions** without a full plugin platform (canvas SDK, Python handlers, sandboxes). The Design Agent already loads file skill packs and gates ops via `preferred_tools`.

## Decision

1. **Phase A = Skill playbooks only.** A pack teaches the agent; it does **not** execute `handler.py` yet.
2. **Two product roots only** (later wins on duplicate `skill_key`):
   - `skills/foundation` + `skills/domains` — shipped / first-party
   - `<repo>/plugins/skills` — private / self-host mount
   - Extra dirs from `DESIGN_SKILLS_PLUGIN_DIRS` (comma-separated)
3. **`.agents/skills` is out of product scan** — Cursor/IDE agents only; do not place Design Agent packs there.
4. **Canonical pack layout:**
   ```
   my_poster_plugin/
   ├── _meta.json        # required
   ├── SKILL.md          # required
   ├── schema.json       # optional — input / output JSON Schema
   ├── handler.py        # optional — reserved Phase B (logged, not executed)
   ├── assets/           # optional — logo / icon / previews
   └── examples/         # optional — reference art (docs only)
   ```
5. **`_meta.json` contract** (normalized at load):
   - `skill_key` required (folder name if omitted)
   - `enabled: false` → skip pack
   - `author` / `permissions` → recorded / documented; live ACL remains `preferred_tools` + `allowed_resources`
6. **Later phases** (not this ADR): canvas toolbar plugins (TS), optional skill ops runners (`handler.py`), zip/signature installers.

## Consequences

### Positive

- Private deploys add craft by dropping folders + restart/hot-reload.
- Same Decide / Paint / tool_ops path as shipped skills — no second canvas writer.
- One layout for seeds and plugins; `schema.json` / `assets/` ready without a second format.
- Compose can volume-mount `./plugins/skills` without rebuilding the image.

### Negative / trade-offs

- Deterministic layout still depends on the LLM following `SKILL.md`.
- No process sandbox for skill bodies (they are prompts, not code).
- `handler.py` presence may confuse authors until Phase B docs are prominent.

## Alternatives considered

1. **Runnable `handler.py` + CanvasContext** — deferred; conflicts with tool_ops ownership and needs a runner ADR.
2. **Three roots including `.agents/skills`** — rejected; split IDE vs product catalogs.
3. **Only Admin zip uploads** — kept, but filesystem mount is better for self-host ops.

## References

- [docs/skill-extensions.md](../skill-extensions.md)
- `plugins/skills/README.md`
- `app/services/design/prompts/skill_store/pack_io.py`
- Roadmap Phase A in [platform.md](../roadmap/platform.md)
