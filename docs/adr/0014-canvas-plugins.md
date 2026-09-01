# Extensibility — Canvas plugins (Phase B)

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

After Skill playbooks (ADR 0013), the second extension surface is **canvas-native UI**: toolbar buttons, later export formats / selection chrome. Authors described packs as `manifest.json` + TypeScript entry (e.g. watermark).

## Decision

1. **Phase B = in-process canvas plugins.** Packs under `plugins/canvas/<id>/` register with a small host API (`registerToolbarButton`, …). They run in the editor bundle — **not** a browser sandbox yet.
2. **Host** lives in `apps/web/src/plugins/canvas/host.ts`; the bottom tool strip renders registered buttons after `ensureCanvasPlugins()`.
3. **Scene writes** go through existing editor store helpers (`spawnCreatedNode`, `placeText` on the runtime) — plugins must not invent a second document writer.
4. **Sample:** `plugins/canvas/watermark` — toolbar inserts translucent text.
5. **Out of scope here:** sandboxed iframes, remote CDN plugins, Python `handler.py` runners (Skill Phase next), `.recombyn-plugin` zip install.

## Consequences

### Positive

- Same mount story as Skills (`plugins/…` at repo root).
- Toolbar extensions without editing `EditorToolStrip` for every private button.
- Clear split: Skills = Agent craft; Canvas plugins = editor UI/tools.

### Negative / trade-offs

- Trust model = first-party code until a sandbox lands.
- New packs must be wired into `ensureCanvasPlugins()` (static import) until a zip installer exists.

## Alternatives considered

1. **Only Skill `handler.py` next** — deferred; canvas UI was the second half of the author’s two-system design.
2. **iframe sandbox first** — too heavy for the first mount point.

## References

- [docs/canvas-plugins.md](../canvas-plugins.md)
- `plugins/canvas/README.md`
- `apps/web/src/plugins/canvas/host.ts`
- [ADR 0013](./0013-skill-extensions.md)
