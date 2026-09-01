# Scene JSON spec

Scene JSON is the document on the canvas. This spec matches the Web editor runtime and `packages/scene-schema`.

Canvas paint / Path2D / viewport cull + SoA canvas ink: **[canvas-architecture.md](./canvas-architecture.md)**.

```json
{
  "width": 794,
  "height": 1123,
  "deltaSetLike": {
    "ROOT": { "key": "root", "children": ["nodeId1"] },
    "nodeId1": {
      "key": "text",
      "x": 80,
      "y": 80,
      "width": 240,
      "height": 24,
      "attrs": {
        "ORIGIN_DATA": "Sample text",
        "DATA": { "chars": [] }
      }
    }
  }
}
```

Also common on saved projects:

- `frames` — artboards
- `stackOrder` — unified paint order (`frame:id` | `node:id`, bottom → top)
- `pages` / `activePageId` — page children when used

Types: `apps/web/src/components/rcb/sceneNode.ts`.  
Full JSON Schema: `packages/scene-schema/schema/scene-document.schema.json`.
