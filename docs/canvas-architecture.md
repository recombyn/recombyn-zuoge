# Canvas architecture (RCB)

RCB is zuoge’s infinite vector canvas. This note is for people changing paint, hit-testing, or viewport cull / SoA canvas ink — source of truth is `apps/web/src/components/rcb` + `apps/web/src/components/editor/canvas`. Keep this doc in sync when those constants change.

## Stack

| Layer | Role | Primary paths |
|-------|------|----------------|
| Stage shell | Camera, frames, product canvas | `editor/page/EditorStageWorld.tsx` |
| Camera / pan-zoom | Infinite world (`zoom` ~0.05–100); **CameraTransform** is the sole world↔screen API | `rcb/canvas/RcbCanvas.tsx`, `rcb/core/math.ts`, `rcb/camera/transform.ts` |
| SceneRenderer | Paint/hit backend (`svg` DOM hosts + `canvas2d` grid + SoA vector ink) | `rcb/render/sceneRenderer.ts` |
| Product canvas | Tools, media overlays, store writes; hit via SceneRenderer | `editor/canvas/SvgCanvas.tsx` |
| Shape paint | SoA canvas ink for vectors; DOM hosts for text / media FO / SoftGlow / editors | `rcb/shapes/RcbShapesLayer.tsx`, `RcbShapeHost.tsx` |
| SoA buffer + demotion | Derived paint/pick cache (`SceneRenderBuffer`); never writes back to SceneDocument | `rcb/render/sceneRenderBuffer.ts`, `renderDemotionScheduler.ts` |
| Pixel grid + canvas ink | Grid `[data-rcb-scene-canvas]`; vector ink `[data-rcb-idle-ink-canvas]` | `RcbCanvas` + `createCanvasSceneRenderer` |
| Selection chrome | Shared scene SVG camera group for AABB, path silhouette, shape knobs, guides, and drawing previews; HTML overlay only for screen UI/hit seats | `rcb/selection/SelectionChrome.tsx`, `HostPathChrome.tsx`, chrome overlays |
| Transform gestures | `pointermove` → RAF-coalesced live preview into `TransformPreview` + transitional SVG DOM; `pointerup` commits SceneDocument and clears preview | `core/transformPreview.ts`, `SelectionFeature` coalescer, `canvasSession.onGeometryPreview/Commit` |
| Frame clip (live) | Artboard move: preview plate geom (+ live artboard map) → re-seat bound hosts via `nodeLeftTop` → `syncFrameContentClip` (no child TransformPreview under frameLocal) | `EditorStageWorld`, `canvasSession.onGeometryPreview` |
| Pointer hit | Overlay seats → chrome **geometry** → shared `SceneSpatialRuntime` → Path2D/AABB (SVG DOM off by default) | `pickSelectionInkAtClient`, `hitTestWithSpatialIndex`, `setSharedSceneSpatialRuntime` |
| Document model | Types + Zod | `rcb/sceneNode.ts`, `packages/scene-schema` |
| Mutations | normalize / stack / CRUD | `rcb/scene/document/sceneDocument.ts` |
| Live state | `document`, selection, tools | `store/modules/editor.ts` |
| React subscriptions | Narrow editor hooks only — live vs commit-only document | `store/editorSelectors.ts` (`useEditorDocument` / `useEditorDocumentOnCommit`) |
| Undo | COW / patch history | `store/modules/editorHistory.ts` |
| Collab | Yjs ↔ scene ↔ editor store | `editor/collab/sceneYBridge.ts`, `CollabRoomProvider.tsx` |

**Fact layer (ADR 0027):** `SceneDocument` + `CameraTransform` + `SceneSpatialRuntime`. SVG/`sceneToSvg` is export + transitional live paint — not the interaction substrate. SoA buffers are a **derived** paint/pick cache only.

**Normative constraints (hit / camera):** [ADR 0027](./adr/0027-canvas-layered-runtime.md) — one CameraTransform, one hit pipeline, visual = hit = lattice.

## Document shape

`SceneDocument` (see also [scene-json-spec.md](./scene-json-spec.md)):

- **`deltaSetLike`**: flat `id → SceneNode` map; `ROOT.children` (or page children) lists top-level nodes
- **`frames`**: **artboards** (fixed design plates). Not the camera **viewport**. Paint order unified in **`stackOrder`** (`frame:id` | `node:id`, bottom → top)
- Node fields: `id`, `key`, `x/y/width/height`, `attrs`, `children[]`
- **Canonical attrs (current writers):** `'fill-color'`, `'border-color'` / stroke via `resolveStroke`; blend via `blendMode`; skew via `skewX` + `skewAxis`. Do not reintroduce dual-key readers.
- **Frame `kind`:** `'artboard'` | `'animation'` (动画工作台). Document load rewrites any leftover `lottie` plate kind to `'animation'`. Node `key: 'lottie'` remains the Lottie asset node type.
- **Workbench host flag:** `attrs.animationFrameHost` only (load rewrites leftover `lottieFrameHost`).
- **`coordSpace: 'frameLocal'`** (set by `normalizeDocument`): nodes with `attrs.frameId` store **plate-local** `x/y` (00 = frame top-left). Paint/hit use `nodeLeftTop` = live-or-doc frame origin + local. Moving a plate updates `frames[].x/y` (+ live artboard geom); child attrs do **not** co-move.

There is **no hard max node count** on the document. Capacity is governed by paint/hit budgets below.

## Paint model (what you see)

### Pixel grid → Canvas2D grid surface

At ≥ `PIXEL_GRID_MIN_ZOOM` (~800%), `RcbCanvas` paints the lattice on a screen-space `[data-rcb-scene-canvas]` via `createCanvasSceneRenderer` / `drawSceneGrid` (camera baked into ctx; axes stay on `gℤ` — same as `snapCoordToGrid` / pen tips; do **not** device-shift axes off the snap lattice). SVG no longer carries the grid `<path>`.

**Single vector ink:** canvas-capable nodes (`canIdlePaintOnCanvas`) publish through `setSceneCanvasIdlePaint` and paint on the SoA ink canvas (above frame plates, below DOM hosts, frame-clipped). Selection does **not** promote basic shapes to SVG. DOM hosts stay for text, media FO, path/text editors, heavy paths, non-center `strokeAlign`, blend/blur, and SoftGlow / inline editors via `forceFullSet`. SoftGlow process chrome lives on shape hosts (`attrs.processStatus`), not a separate process SVG mount. There is no far-zoom placeholder LOD and no `[data-rcb-lod-layer]`.

### SoA buffer + promote / demote

| Piece | Role |
|-------|------|
| `SceneRenderBuffer` | Typed arrays + `idToIndex` / freeSlots; derived from SceneDocument |
| `SoaQuadtree` (`buf.quadtree`) | Idle-ink broad-phase for paint / SoA hit / rect cull |
| `SceneSpatialRuntime` | Shared product spatial (all nodes); large N patches AABBs from SoA on demotion wake |
| `RenderDemotionScheduler` | Hints: `ACTIVE_SVG` → `CANDIDATE` → `DEPLOYED_SOA` |
| `soaBakeLayer` | Tile bake + `elementToTiles` / `tileToElements` when count is large |

**Demotion (current):** SoftGlow / editors enter `forceFull` → `ACTIVE_SVG`. Leaving forceFull starts `CANDIDATE`: SoA ink flags / QT / bake bind **immediately** while the DOM host is still held. A single shared wake timer scans `Map<id, lastActive>` and batch-releases host holds after ~300ms quiet (not per-id `setTimeout`). Selection alone never forces SVG hosts.

**Sync:** full rebuild uses `skipQuad` then one `quadtree.replaceAll` (avoid O(n²) expand-rebuild). Incremental patches ≥8 ids use bulk insert / QT upsert. TransformPreview marks QT dirty + live-AABB filter (threshold rebuild at 48 dirty); modest rotate pad (~32), not a full-N scan or fat 512 pad.

### DOM hosts (text / media / editors)

Text, image/video foreignObjects, SoftGlow, and live editors mount as **per-node SVG/DOM hosts** (`RcbShapeHost`), ordered by `stackOrder`. Hosts, media `foreignObject`s, drawing previews, guides, and selection chrome all share one stage-sized SVG and one camera `<g>`. The CSS world layer and live host `left/top/viewBox` camera cancellation path were removed; do not restore either one.

#### Direct size edits and host notifications

- Width / height fields calculate one complete scene box (`left`, `top`, `width`, `height`), preview that exact box on the mounted SVG, then persist the same box in `SceneDocument`. A size edit never uses a centre-anchored preview followed by a top-left-anchored commit.
- A successfully previewed geometry edit must use `skipHostReload`; rebuilding a host after the DOM already has the final geometry causes a stale intermediate frame and desynchronizes selection chrome.
- `shapeHostRegistry` supports both global world-mount listeners and per-node listeners. Title chrome must subscribe by node id, not to every host event. Global subscriptions are reserved for a component that genuinely depends on the whole mount topology.
- Host jump diagnostics are development-only and bounded. Do not add unbounded arrays or console logging to pointer / remount paths.

### Title editing and history

Node and artboard titles are native-input edits: the browser owns the active input value and `onChange` writes the latest title immediately. The first character records the undo snapshot; subsequent characters use `skipHistory`, so one edit session is one undo step. A metadata-only name update must not reload SVG paint.

### Live drawing → SVG preview (not Path2D)

Pen, pencil, shape, and frame tools portal preview into a shared scene SVG mount (`getSceneDrawPreviewMount` in `shapeHostRegistry.ts`):

- **Pen / path edit** — SVG `<g>` preview (`PenDrawFeature`, `PenPathEditFeature`). Entering path edit bakes `flipX`/`flipY` into anchors (`flipAnchorsAroundCenter`) so the host-hidden path matches the flipped ink; commit clears flip flags.
- **Pencil** — filled **SVG ribbon** from `outlinePathFromPoints` (`pencilBrushes.ts`); preview and commit share that outline
- **Shape / frame draw** — SVG stroke/box preview portals

Live drawing portals into the shared camera group.

### Path2D role (not main paint)

From `sceneShapes.ts`:

> Committed vectors paint as SoA canvas ink; Path2D is the shared vector kernel.

Used for:

- Hit-testing (`hitTestPath2DLocal`, `sceneHitBridge.ts`)
- Selection / draw-tool overlay strokes (`strokeCachedPath2D` / `fillCachedPath2D`)
- Cached `Path2D` by path `d` (LRU-ish, `PATH2D_CACHE_MAX = 256`)

### Pencil “ribbon”

Vector freehand is a **path-centered filled outline** (pressure + taper):

1. Centerline points (gap-filled). Shift+pencil snaps an octant-straight segment
2. `outlinePathFromPoints` builds a closed SVG `d`
3. Fill with the ink color; optional silhouette stroke (`pencilOutlineWidth` / `pencilOutlineColor`)

Same path builder for live preview and commit.

Built-in `brushStyle` ids (`PENCIL_BRUSHES` in `pencilBrushes.ts`; default `vector-ink`):

| Id | Role |
|----|------|
| `vector-ink` | Balanced ink; width follows hardware pressure |
| `vector-even` | Near-constant width |
| `vector-calligraphy` | Strong pressure range |
| `vector-pencil` | Lighter sketch |
| `vector-marker` | Broad marks |
| `vector-brush` | Broad pressure-sensitive |
| `vector-fountain` | Fine ink |
| `vector-technical` | Even linework |
| `vector-soft` | Soft wide marks |

Toolbar: fill color, Size (Px = `penStrokeWidth` / node `borderWidth`), settings (thinning, streamline, smoothing, easing, taper/cap start+end, fill, silhouette stroke, reset). Pen mode also has 退出编辑.

Committed attrs include centerline `path`, `pathPressure`, `brushStyle`, `pressureEnabled`, `pencilFill`, `pencilOutlineWidth`, `pencilOutlineColor`.

## Viewport cull + canvas ink

Implemented in `RcbShapesLayer.tsx` (current constants):

| Constant | Value | Meaning |
|----------|------:|---------|
| `CULL_PAD_SCREEN_PX` | 96 | Extra screen margin before unmount |
| `INDEX_CULL_THRESHOLD` | 64 | Prefer spatial index over O(N) AABB walk |
| `EFFICIENT_ZOOM_SHAPE_THRESHOLD` | 80 | While camera moving, tighten cull zoom |
| `MAX_CANVAS_INK_PAINT` | **4096** | Cap on SoA canvas ink ids |
| `HEAVY_PATH_D_CHARS` | 12_000 | Heavy path → DOM host / hit cost (`sceneShapes.ts`) |

Spatial: `SceneSpatialRuntime` / `RcbSpatialIndex` are **quadtree-backed** (`SoaQuadtree`). The constructor `cellSize` argument is only a leaf-capacity hint (SvgCanvas still passes 256). Large-scene helpers also use `SCENE_SPATIAL_LARGE_THRESHOLD` (48) in `spatialIndex.ts`. Idle SoA paint/hit additionally uses `buf.quadtree`.

**Rule of thumb:** document can hold thousands of light shapes (stress benches exercise 1k–10k); vectors paint on one SoA canvas ink surface; DOM hosts are for text/media/editors only. Off-screen nodes are culled (not mounted).

## History / agent (related caps)

| Cap | Value | Where |
|-----|------:|--------|
| Undo entries | 50 | `HISTORY_MAX_ENTRIES` |
| Undo bytes | 64 MiB | `HISTORY_MAX_BYTES` |
| Agent inventory | ~120 nodes default | `runDesignAgent.ts` `maxNodes` — **prompt budget only**, not editor limit |

## Practical capacity

- **Light vectors:** hundreds → low thousands with cull + SoA canvas ink + QT
- **Dense scenes:** one ink surface (real paint), not host-overflow dual path
- **Many videos / animations / generators:** DOM + decode dominate before node-count alone
- **Huge path `d`:** hit-test / history pressure (`HEAVY_PATH_D_CHARS`)

## Key files (quick map)

```
apps/web/src/components/rcb/
  canvas/RcbCanvas.tsx                # stage layers: grid → frames → ink → hosts → chrome
  shapes/RcbShapesLayer.tsx           # cull + DOM hosts vs SoA canvas ink + demotion wiring
  shapes/shapeHostRegistry.ts         # host registry + draw / guides / selection mounts
  render/sceneRenderBuffer.ts         # SoA typed arrays, paint, QT sync
  render/renderDemotionScheduler.ts   # ACTIVE_SVG / CANDIDATE / DEPLOYED_SOA
  render/soaBakeLayer.ts              # tile bake + element↔tile maps
  core/soaQuadtree.ts                 # idle + spatial QT
  core/spatialIndex.ts                # SceneSpatialRuntime (QT-backed)
  scene/document/sceneShapes.ts       # Path2D cache + ribbon outline helpers
  scene/document/sceneHitBridge.ts
  frames/frameContentClip.ts          # clip-content sync during artboard drag
  tools/PenDrawFeature.tsx
  tools/PenPathEditFeature.tsx        # path edit + flip bake
  tools/PencilDrawFeature.tsx
  tools/pencilBrushes.ts
  tools/ShapeDrawFeature.tsx
apps/web/src/components/editor/canvas/SvgCanvas.tsx
apps/web/src/components/editor/canvas/canvasSession.ts
apps/web/src/store/editorSelectors.ts
docs/scene-json-spec.md
docs/adr/0027-canvas-layered-runtime.md
```
