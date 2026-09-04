# Canvas architecture (RCB)

RCB is zuoge’s infinite vector canvas. This note is for people changing paint, hit-testing, or viewport cull / SoA canvas ink — source of truth is `apps/web/src/components/rcb` + `apps/web/src/components/editor/canvas`. Keep this doc in sync when those constants change.

## Stack

| Layer | Role | Primary paths |
|-------|------|----------------|
| Stage shell | Camera, frames, product canvas | `editor/page/EditorStageWorld.tsx` |
| Camera / pan-zoom | Infinite world (`zoom` ~0.05–100); **CameraTransform** is the sole world↔screen API | `rcb/canvas/RcbCanvas.tsx`, `rcb/core/math.ts`, `rcb/camera/transform.ts` |
| SceneRenderer | Paint/hit backend (`svg` DOM hosts + `canvas2d` grid + world SoA/WebGL + ArtboardLayer) | `rcb/render/sceneRenderer.ts` |
| Product canvas | Tools, media overlays, store writes; hit via SceneRenderer | `editor/canvas/SvgCanvas.tsx` |
| Pixel grid + ink | Grid `[data-rcb-scene-canvas]`; world idle `[data-rcb-idle-ink-canvas]`; plate-bound idle via ArtboardLayer | `RcbCanvas` + `createCanvasSceneRenderer` + `artboardInkSurface` |
| Shape paint | World WebGL (unbound) + ArtboardLayer small-canvas (bound) + FO hosts by `stackOrder` | `rcb/shapes/RcbShapesLayer.tsx`, `RcbShapeHost.tsx`, `frames/HtmlArtboardFrame.tsx`, `frames/artboardInkSurface.ts`, `scene/document/sceneStackPainter.ts` |
| SoA buffer + demotion | Derived paint/pick cache (`SceneRenderBuffer`); never writes back to SceneDocument | `rcb/render/sceneRenderBuffer.ts`, `renderDemotionScheduler.ts` |
| Selection chrome | Shared scene SVG camera group for AABB, path silhouette, shape knobs, guides, and drawing previews; HTML overlay only for screen UI/hit seats | `rcb/selection/SelectionChrome.tsx`, `HostPathChrome.tsx`, chrome overlays |
| Transform gestures | `pointermove` → RAF-coalesced live preview into `TransformPreview` + transitional SVG DOM; `pointerup` commits SceneDocument and clears preview | `core/transformPreview.ts`, `SelectionFeature` coalescer, `canvasSession.onGeometryPreview/Commit` |
| Frame clip (live) | Artboard move: preview plate geom (+ live artboard map) → re-seat bound hosts via `nodeLeftTop` → `syncFrameContentClip` (no child TransformPreview under frameLocal). SoA QT uses the same mid-gesture dirty + liveAabb rescue as TransformPreview so plate-bound ink is not culled with stale AABBs | `EditorStageWorld`, `canvasSession.onGeometryPreview`, `prepareSoaQuadtreeForQuery` |
| Pointer hit | Overlay seats → chrome **geometry** → one `SceneSpatialRuntime` QT (nodes + `frame:id`) → permanent `stackOrder` top-first → precise Path2D/AABB/plate | `hitTestWithSpatialIndex`, `hitTestUnifiedStackAtPoint`, `setSharedSceneSpatialRuntime` |
| Document model | Types + Zod | `rcb/sceneNode.ts`, `packages/scene-schema` |
| Mutations | normalize / stack / CRUD | `rcb/scene/document/sceneDocument.ts` |
| Live state | `document`, selection, tools | `store/modules/editor.ts` |
| React subscriptions | Narrow editor hooks only — live vs commit-only document | `store/editorSelectors.ts` (`useEditorDocument` / `useEditorDocumentOnCommit`) |
| Undo | COW / patch history | `store/modules/editorHistory.ts` |
| Collab | Yjs ↔ scene ↔ editor store | `editor/collab/sceneYBridge.ts`, `CollabRoomProvider.tsx` |

**Fact layer (ADR 0027):** `SceneDocument` + `CameraTransform` + `SceneSpatialRuntime`. SVG/`sceneToSvg` is export + transitional live paint — not the interaction substrate. SoA buffers are a **derived** paint/pick cache only.

**Normative constraints (hit / camera):** [ADR 0027](./adr/0027-canvas-layered-runtime.md) — one CameraTransform, one hit pipeline (QT → permanent stackOrder → precise), visual = hit = lattice. SoA QT is paint/cull only.

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

**Paint stack:**

```text
grid (Canvas2D) → world WebGL (unbound idle) → stack by stackOrder (ArtboardLayer + FO hosts) → chrome
```

One SVG mount holds artboard plate layers + DOM hosts, ordered by `stackOrder` (`data-z` via `syncStackPaintOrder`). Each plate layer embeds an **ArtboardLayer** small canvas (plate fill + bound idle SoA ink via `artboardInkSurface`). World SoA/WebGL on `[data-rcb-idle-ink-canvas]` paints unbound idle only (`skipFrameBound`). Unbound nodes stacked above any plate promote to DOM hosts. Do not reintroduce per-type CSS z bands, host-occlusion clips, plate cutouts, or bound-idle→SVG-host paint.

**Idle ink:** canvas-capable nodes (`canIdlePaintOnCanvas`) publish through `setSceneCanvasIdlePaint`. Unbound → world WebGL; bound → owning ArtboardLayer. Selection does **not** promote basic shapes to SVG. DOM hosts stay for **lottie/group**, path editors, heavy paths, **backdrop-blur**, SoftGlow via `forceFullSet`, puppet-warp images, and the **active** video/audio decoder (≤1 FO each) — including when frame-bound (FO sits above the plate canvas via `data-z`). Object blur + inner-shadow bake on canvas idle (`paintLocalInkWithObjectEffects`). Non-normal **blendMode** idles via underlay + `globalCompositeOperation` (`paintLocalInkWithBlend`). SoftGlow process chrome lives on shape hosts (`attrs.processStatus`). strokeAlign inside/outside paints on canvas ink (SoA basic or rich idle).

### SoA buffer + promote / demote

| Piece | Role |
|-------|------|
| `SceneRenderBuffer` | Typed arrays + `idToIndex` / freeSlots; derived from SceneDocument |
| `SoaQuadtree` (`buf.quadtree`) | Idle-ink broad-phase for paint / SoA hit / rect cull |
| `SceneSpatialRuntime` | Shared product spatial (all nodes); large N patches AABBs from SoA on demotion wake |
| `RenderDemotionScheduler` | Hints: `ACTIVE_SVG` → `CANDIDATE` → `DEPLOYED_SOA` |
| `soaBakeLayer` | Tile bake + `elementToTiles` / `tileToElements` when count is large |

**Demotion (current):** SoftGlow / editors enter `forceFull` → `ACTIVE_SVG`. Leaving forceFull starts `CANDIDATE`: SoA ink flags / QT / bake bind **immediately** while the DOM host is still held. A single shared wake timer scans `Map<id, lastActive>` and batch-releases host holds after ~300ms quiet (not per-id `setTimeout`). Selection alone never forces SVG hosts.

**Sync:** full rebuild uses `skipQuad` then one `quadtree.replaceAll` (avoid O(n²) expand-rebuild). Incremental patches ≥8 ids use bulk insert / QT upsert. TransformPreview **and** live artboard plate mark QT dirty + live-AABB filter on query (**no mid-gesture rebuild** — that froze multi-drags); restamp once when previews / live plate clear. Modest rotate pad (~64).

### DOM hosts (FO media / SoftGlow / editors / stack promotion)

Idle text / image / video poster / audio plate / gradient / poly paint as ink (world WebGL or ArtboardLayer). DOM hosts (`RcbShapeHost`) remain for FO media, SoftGlow, live editors, lottie/group, and any unbound world node whose `stackOrder` sits above an artboard plate. Hosts and artboard plate layers share one stack SVG mount ordered by `stackOrder`. Drawing previews, guides, and selection chrome share the camera surface. The CSS world layer and live host `left/top/viewBox` camera cancellation path were removed; do not restore either one.

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

**Rule of thumb:** document can hold thousands of light shapes (stress benches exercise 1k–10k); unbound vectors idle on world SoA/WebGL; frame-bound idle ink lives on per-artboard small canvases (ArtboardLayer) interleaved with FO hosts by `stackOrder`; DOM hosts are for FO media / SoftGlow / editors / stack promotion above plates. Off-screen nodes are culled (not mounted).

## History / agent (related caps)

| Cap | Value | Where |
|-----|------:|--------|
| Undo entries | 50 | `HISTORY_MAX_ENTRIES` |
| Undo bytes | 64 MiB | `HISTORY_MAX_BYTES` |
| Agent inventory | ~120 nodes default | `runDesignAgent.ts` `maxNodes` — **prompt budget only**, not editor limit |

## GPU depth-of-field (opt-in)

Replaces CPU tile bake during interactive DOF (`VITE_GPU_DOF=1`). Does **not** change SceneDocument, SoA buffer layout, DOM host budget, or export.

| Backend | Role |
|---------|------|
| **WebGL2** (`webglDepthOfFieldPass.ts`) | Color + depth MRT FBO → CoC separable blur → screen. Skips `soaBakeLayer` tile bake. Depth from `buildNodeStackZMap` normalized per frame. |
| **WebGPU** (`webgpuSceneRenderer.ts`) | Full MRT scene + CoC blur on `navigator.gpu`. Prefer `VITE_GPU_DOF_BACKEND=webgpu`. |

Runtime uniforms: `focalDepth`, `aperture`, `maxCoCPx`, `downsample`. Tunable in Effects panel (**Scene depth of field**) when the env flag is on. `setGpuDepthOfFieldParams` notifies subscribers → ink backend recreate + full repaint. Per-node object blur / backdrop blur unchanged.

## Practical capacity

- **Light vectors:** hundreds → low thousands with cull + SoA canvas ink + QT
- **Dense scenes:** world WebGL + per-artboard ArtboardLayer ink (real paint); FO hosts stay exceptional
- **Many videos / animations / generators:** DOM + decode dominate before node-count alone
- **Huge path `d`:** hit-test / history pressure (`HEAVY_PATH_D_CHARS`)

## Key files (quick map)

```
apps/web/src/components/rcb/
  canvas/RcbCanvas.tsx                # stage: grid → world SoA ink → stack SVG (plates+hosts) → chrome
  frames/HtmlArtboardFrame.tsx        # plate layer + ArtboardLayer FO canvas mount
  frames/artboardInkSurface.ts        # per-frame plate fill + bound idle SoA ink
  shapes/RcbShapesLayer.tsx           # cull + DOM hosts vs SoA canvas ink + demotion wiring
  shapes/shapeHostRegistry.ts         # host registry + shared stack mount paint order
  scene/document/sceneStackPainter.ts # stackOrder → data-z contract
  render/sceneRenderBuffer.ts         # SoA typed arrays, paint, QT sync
  render/renderDemotionScheduler.ts   # ACTIVE_SVG / CANDIDATE / DEPLOYED_SOA
  render/soaBakeLayer.ts              # world tile bake (skipFrameBound) + element↔tile maps
  render/gpuDepthOfField.ts           # DOF params + stack depth normalization
  render/webglDepthOfFieldPass.ts     # WebGL2 FBO + CoC blur
  render/webgpuSceneRenderer.ts       # WebGPU MRT scene + CoC DOF (async device)
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
