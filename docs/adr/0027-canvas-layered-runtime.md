# ADR 0027: Scene + camera + layered render + independent hit

- **Status:** Accepted
- **Date:** 2026-08-15
- **Updated:** 2026-09-02 — Phase 5 GPU depth-of-field (opt-in WebGL2 / WebGPU); dual SVG+underlay migration language removed
- **Supersedes (partial):** [ADR 0002](./0002-canvas-rcb-runtime.md) runtime paint/hit coupling — RCB ownership stays; SVG is no longer the editor runtime fact layer.

## Context

RCB already owns `SceneDocument`, camera math (`rcb/core/math.ts`), and `SceneSpatialRuntime`. Live editing previously coupled **paint, hit-testing, and selection chrome** through SVG/DOM:

- One world layer drove SVG + HTML via CSS `translate + scale`.
- Selection chrome / path handles mirrored host `viewBox` and used `1/zoom` counter-scale.
- Frequent `querySelector` / `getBoundingClientRect` / multi-surface z-index sync drifted under pan, zoom (5%–10_000%), and dense scenes.

SVG remains fine for export and moderate static paint. It must not remain the interaction and control-box substrate.

## Decision

Treat the editor runtime as four facts (**this is the product architecture — do not invent a parallel one mid-fix**):

1. **`SceneDocument`** — unique document source of truth (store / collab patches write here).
2. **`CameraTransform`** — single pan/zoom matrix; only `worldToScreen` / `stageLocalToWorld` / `screenDeltaToWorldDelta` on hot paths. No DOM “correction” of coordinates during gestures.
3. **Layered render** — **single SoA Canvas2D vector ink**; DOM hosts only for text / media FO / SoftGlow / editors / heavy paths; grid on Canvas; selection, guides, and drawing previews share the camera surface; screen UI stays in the HTML overlay. SoftGlow/editors use `RenderDemotionScheduler` (`ACTIVE_SVG` → `CANDIDATE` → `DEPLOYED_SOA`); selection does **not** promote basic shapes onto SVG.
4. **Independent hit** — root pointer capture → chrome hit → spatial index coarse → precise geometry. `sceneToSvg` stays an **export** path, not the live paint core.

SVG is not the editor runtime fact layer. Fact layer = `SceneDocument` + `CameraTransform` + `SceneSpatialRuntime`. SoA (`SceneRenderBuffer` + `SoaQuadtree`) is a **derived** paint/pick cache and must not write back into SceneDocument. Demotion host-release uses one shared wake over `lastActive` timestamps; TransformPreview uses dirty AABB + live filter + threshold rebuild (not per-frame QT upsert).

### Delivery roadmap (phased — no rewrite)

| Phase | Status | Goal |
|-------|--------|------|
| 1 | Done (core) | CameraTransform API; ink and selection chrome share the same SVG root and camera `<g>`; geometry-first chrome hit; shared spatial; union AABB chrome. |
| 2 | Done (core) | `SceneRenderer` (`svg` hosts + `canvas2d` grid); canvas-capable vectors on idle ink (`canIdlePaintOnCanvas` + rounded/poly Path2D). |
| 3 | Done (default-on) | **SoA** `SceneRenderBuffer` default-on Canvas2D (`VITE_SOA_CANVAS_SHAPES=0` kill-switch); single vector ink; radii + outline stroke (`strokeAlign` center|inside|outside) + simple poly/star samples; static **text** on canvas idle (`paintCanvasTextInk`); static **image** + idle **video** posters on canvas; selected video keeps FO for HTML `<video>`; AI lock → one flush; shared spatial from SoA; dirty AABB; bake ≥8k; **quadtree** idle cull; demotion scheduler + freeSlots / bulk sync. Lottie/audio / SoftGlow / pen editors / heavy paths stay DOM hosts. Text caret = screen overlay. |
| 4 | Frozen (opt-in) | WebGL2 instancing + path densify + atlas — **not** product default. Outline stroke / poly stay off WebGL instances while `VITE_SOA_WEBGL=1`. Converge later; do not dual-default. |
| 5 | Opt-in | **GPU realtime depth-of-field** (`VITE_GPU_DOF=1`): color + depth MRT → CoC → separable blur → composite. Depth from `buildNodeStackZMap` (no new SceneDocument attrs). While DOF is active, skip CPU `soaBakeLayer` tile bake (`gpuDofSkipsSoaTileBake`). Backends: WebGL2 (`webglDepthOfFieldPass` + `webglSceneRenderer`) or WebGPU (`webgpuSceneRenderer`). UI: Effects → Scene depth of field. Does not change SoA layout, DOM host budget, or export. |

### Acceptance targets

- 10k light nodes pan at stable 60 FPS
- Pointer-move → paint P95 &lt; 16ms; single-point hit P95 &lt; 1ms
- Non-media DOM node count in the low hundreds
- Zoom 5%–10_000%: element/control geometry transform error = 0
- Drag does not dispatch full editor store scene updates
- Export and screen share one `SceneDocument`, without depending on live DOM ink

## Consequences

### Positive

- Chrome handle size stays constant in screen px via scene sizing (`px / zoom`); no second camera/viewBox mirror is used for chrome.
- Hit and paint share one coordinate pipeline; fewer SVG lattice races.
- Direct size fields preview and persist one identical scene box, so resize chrome cannot visibly interpolate through a different anchor.
- Host lifecycle notifications can be scoped to an individual node, preventing unrelated title chrome from rerendering during a mount or paint refresh.
- Can replace paint backend without rewriting selection / tools.
- Dense idle ink uses QT + optional tile bake; demotion avoids blank frames by preparing SoA ink before releasing DOM hosts.

### Negative / trade-offs

- Two spatial consumers remain intentional: `SceneSpatialRuntime` (product hit / all nodes) and `buf.quadtree` (idle SoA paint/pick). Keep them in sync on demotion wake via id-scoped patches, not full-buffer upserts when N is large.
- Contributors must not add new world-layer control SVG that mirrors host `viewBox`.
- Do not reintroduce dual attr keys (`fill` vs `fill-color`, frame `kind: 'lottie'`, `lottieFrameHost`, axios-shaped error probes).

## Alternatives considered

1. **Keep SVG runtime, harden viewBox sync** — rejected; complexity grows with zoom and node count.
2. **Adopt an external whiteboard SDK** — rejected (ADR 0002); product artboards / agents / media stay in-house.
3. **Jump straight to WebGL** — rejected; stabilize camera + hit + chrome first.

## References

- [docs/canvas-architecture.md](../canvas-architecture.md)
- `apps/web/src/components/rcb/camera/transform.ts`
- `apps/web/src/components/rcb/render/sceneRenderer.ts`
- `apps/web/src/components/rcb/render/sceneRenderBuffer.ts`
- `apps/web/src/components/rcb/render/renderDemotionScheduler.ts`
- `apps/web/src/components/rcb/core/soaQuadtree.ts`
- `apps/web/src/components/rcb/core/spatialIndex.ts`
- `apps/web/src/components/rcb/render/gpuDepthOfField.ts`
- `apps/web/src/components/rcb/render/webglDepthOfFieldPass.ts`
- `apps/web/src/components/rcb/render/webgpuSceneRenderer.ts`
- `apps/web/src/components/rcb/selection/SelectionChrome.tsx`
