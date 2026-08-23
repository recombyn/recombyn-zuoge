# Canvas plugins (`plugins/canvas`)

You can add editor UI here (toolbar buttons today). This is separate from AI Skill packs under `plugins/skills/`.

## Layout

```
my_toolbar_plugin/
├── manifest.json   # id / name / mounts / permissions
├── icon.svg        # toolbar thumb
└── index.ts        # register(api) — toolbar / future export hooks
```

## What works today

| Mount | Status |
|-------|--------|
| `toolbar` | Bottom tool strip extra buttons |
| Export formats / selection chrome | Later |
| Browser sandbox | Later (plugins run in-process today) |

## Sample

`watermark/` — toolbar button inserts translucent `© Watermark` text.

Shipped packs are imported by `apps/web/src/plugins/canvas/host.ts` at editor boot. Self-host: add a pack folder and register it in `ensureCanvasPlugins()`.

See [docs/canvas-plugins.md](../../docs/canvas-plugins.md).
