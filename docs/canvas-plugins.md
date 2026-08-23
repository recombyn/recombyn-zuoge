# Canvas plugins (authoring)

You can add editor UI with a canvas plugin (toolbar buttons today). This is separate from AI Skill packs (`plugins/skills/`) — don’t mix the two roots.

## Layout

```
plugins/canvas/my_tool/
├── manifest.json
├── icon.svg
└── index.ts          # default export: { manifest, register(api) }
```

## `manifest.json`

| Field | Required | Notes |
|-------|----------|--------|
| `id` | yes | Stable pack id |
| `name` | yes | Display / fallback tip |
| `version` | optional | Semver string |
| `enabled` | optional | `false` skips install |
| `mounts` | optional | e.g. `["toolbar"]` (docs; host uses what you register) |
| `permissions` | optional | Docs / future ACL (`insert_nodes`, …) |

## `register(api)`

```ts
api.registerToolbarButton({
  id: 'my_tool.action',
  tip: 'Do the thing',
  order: 200,
  iconSrc: iconUrl,
  onClick(runtime) {
    runtime.placeText({ text: 'Hello', opacity: 0.4 });
  },
});
```

Runtime helpers: `placeText`, `viewportCenterDoc`, `dispatch`, `getState`.

## Load path

1. Add the folder under `plugins/canvas/`.
2. Import it from `ensureCanvasPlugins()` in `apps/web/src/plugins/canvas/host.ts` (static list for now).
3. Restart / refresh the web app.

Vite alias: `@canvas-plugins/*` → `plugins/canvas/*`.

## Sample

[`plugins/canvas/watermark`](../plugins/canvas/watermark/) — bottom strip button → translucent `© Watermark`.

## Later

Export format registry, selection chrome hooks, sandboxed loaders, zip install.

→ [ADR 0014](./adr/0014-canvas-plugins.md) · Skills: [skill-extensions.md](./skill-extensions.md)
