# ADR 0027: Scene + camera + layered render + independent hit

- **Status:** Accepted
- **Date:** 2026-08-15
- **Updated:** 2026-09-06 — Plate-bound selection/reveal promotes to SVG host at max+1 (`pickFullAndCanvasIds`); FO/`onlyFrameId` skips `frameClipRevealsOverflow` (no clipped ghost + under-plate dual paint). 2026-09-05 — ArtboardLayer ink = shared WebGL2 SoA/mesh blit onto per-plate FO canvas (`onlyFrameId`); FO stackOrder unchanged. 2026-09-04 — Artboard = small canvas (per-plate ArtboardLayer ink + FO by `stackOrder`); world WebGL unbound-only (`skipFrameBound`). Earlier: unified `stackOrder` paint + ideal hit.
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
3. **Layered render** — paint order is:

   ```text
   grid (Canvas2D) → world WebGL (unbound idle) → stack by stackOrder (ArtboardLayer ink + FO hosts) → chrome
   ```

   - **World WebGL2** instanced SoA ink on `[data-rcb-idle-ink-canvas]` paints **unbound** idle nodes only (`collectSoaWebglInstances` + `skipFrameBound`). World tile bake (`soaBakeLayer`) likewise skips plate-bound slots.
   - **ArtboardLayer** (per `document.frames[]`): plate fill on SVG; **bound idle SoA ink via shared WebGL2** (`artboardWebglInk` / `collectSoaWebglInstances` + `onlyFrameId`) blit onto the per-plate FO canvas (`artboardInkSurface` / `HtmlArtboardFrame`). Same mesh path as world ink; FO/editor hosts for that plate stay siblings on the stack mount ordered by `stackOrder`, so a selected video can sit between two artboards.
   - **DOM hosts** for FO media, SoftGlow, editors, lottie/group, heavy paths, unbound nodes stacked above any plate, **and plate-bound nodes while selected / overflow-revealed** (max+1 `data-z` — world WebGL cannot cover plate fill). Bound **idle** vectors/media posters use ArtboardLayer ink — never SVG hosts for ownership alone. FO/`onlyFrameId` collect **skips** `frameClipRevealsOverflow` so reveal does not leave a clipped ghost on the plate.
   - **Grid** stays on a separate Canvas2D surface. Selection, guides, and drawing previews share the camera surface; screen UI stays in the HTML overlay.
   - SoftGlow/editors use `RenderDemotionScheduler` (`ACTIVE_SVG` → `CANDIDATE` → `DEPLOYED_SOA`); selection does **not** promote **world** basic shapes onto SVG (within-ink raise only). **Plate-bound** basics **do** promote on raise/reveal.
   - **Forbidden:** per-type CSS z bands, host-occlusion / plate-cutout paint hacks, global “bound idle → SVG host”, or “transparent plate + draw bound ink on world WebGL” (breaks FO between plates).

4. **Independent hit** — root pointer capture → chrome hit → **one** `SceneSpatialRuntime` QT (`searchPoint`, nodes + `frame:id` plates) → permanent `stackOrder` top-first → first precise geometry or plate AABB (`hitTestUnifiedStackAtPoint`). Frame picks return `__frame__:id`. SoA `buf.quadtree` is paint/cull only. `sceneToSvg` stays an **export** path, not the live paint core.

SVG is not the editor runtime fact layer. Fact layer = `SceneDocument` + `CameraTransform` + `SceneSpatialRuntime`. SoA (`SceneRenderBuffer` + `SoaQuadtree`) is a **derived** paint/pick cache and must not write back into SceneDocument. Demotion host-release uses one shared wake over `lastActive` timestamps; TransformPreview uses dirty AABB + live filter + threshold rebuild (not per-frame QT upsert).

### Seven necessary product layers (density / interaction)

Do not sell micro-caches or effects as parallel “optimization schemes.” Product narrative is these seven:

| # | Layer | Role |
|---|--------|------|
| 1 | SoA `SceneRenderBuffer` | Typed-array paint/pick cache |
| 2 | Demotion + host viewport cull | DOM budget; who stays SVG vs SoA |
| 3 | World WebGL2 + ArtboardLayer ink | Unbound idle on world GL; plate-bound idle = shared GL → FO canvas |
| 4 | Viewport tile bake + Worker | Second wall when world idle+basic ≥ ~800; live fill until tiles ready |
| 5 | Select raise keep-bake + overpaint | Select must not disable bake |
| 6 | Dirty AABB + SoA QT + incremental sync | Avoid O(N) wipe/rebuild |
| 7 | Independent hit + camera | Architecture; not an FPS knob |

**Embedded (not separate products):** path densify, AI mutation lock, TransformPreview live filter.

**Ink surfaces:** Canvas2D paints the **pixel grid** and Vitest / WebGL-failure survival paths. **ArtboardLayer** product ink is **WebGL on the FO canvas** (shared context + blit; required so FO hosts interleave by `stackOrder`). World unbound idle ink is WebGL. Soft canvas2d world-ink / artboard-ink fallback is survival-only when WebGL2 cannot compile — not the product main path.

**Do not merge:** `SceneSpatialRuntime` (all-node hit) vs `buf.quadtree` (idle paint/pick) — intentional dual track.

**Camera gesture:** while `cameraMoving`, skip Worker bake; live WebGL fills the viewport; bake resumes on settle.

### Delivery roadmap (phased — no rewrite)

| Phase | Status | Goal |
|-------|--------|------|
| 1 | Done (core) | CameraTransform API; ink and selection chrome share the same SVG root and camera `<g>`; geometry-first chrome hit; shared spatial; union AABB chrome. |
| 2 | Done (core) | `SceneRenderer` (`svg` hosts + `canvas2d` grid); canvas-capable vectors on idle ink (`canIdlePaintOnCanvas` + rounded/poly Path2D). |
| 3 | Done (default-on) | **SoA** + world WebGL; **ArtboardLayer** per-frame small canvas (plate + bound idle); stack SVG for plates/hosts by `stackOrder`; selected video/audio ≤1 FO; Lottie / SoftGlow / editors / heavy paths stay DOM hosts. |
| 4 | Done (default-on) | WebGL2 instancing + atlas for **world** idle ink. Viewport bake ≥800 (unbound slots); camera gesture skips bake. |
| 5 | Opt-in **effect** (not density roadmap) | **GPU realtime depth-of-field** (`VITE_GPU_DOF=1`): WebGL2 CoC pass. Skips CPU tile bake while active. UI: Effects → Scene depth of field. |
| 6 | Done (core) | Artboard = small canvas contract above; world collect/bake use `skipFrameBound`. |

### Acceptance targets

- 10k light nodes pan at stable 60 FPS
- Pointer-move → paint P95 &lt; 16ms; single-point hit P95 &lt; 1ms
- Non-media DOM node count in the low hundreds (bound idle vectors must not scale SVG hosts)
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
- ArtboardLayer lets FO media stack between plates without plate cutouts.

### Negative / trade-offs

- Two spatial consumers remain intentional: `SceneSpatialRuntime` (product hit / all nodes) and `buf.quadtree` (idle SoA paint/pick). Keep them in sync on demotion wake via id-scoped patches, not full-buffer upserts when N is large. **Paste / dupe membership growth** uses `restamp` + dirty rescue (compact when dirty &gt; 512); do not `bulkUpsert`/rebuild the whole tree on every Ctrl+V of overlapping stacks.
- Paste undo is `HistoryAdd` (O(paste)), not a full-document history snap. Dock chrome wakes on deferred `documentRevision` after paint — not on `sceneRevision` during the SoA commit.
- Contributors must not add new world-layer control SVG that mirrors host `viewBox`.
- Do not reintroduce dual attr keys (`fill` vs `fill-color`, frame `kind: 'lottie'`, `lottieFrameHost`, axios-shaped error probes).
- Do not add a second async bake scheduler alongside Worker (no idle/main-thread bake dual path).
- Shared GL for ArtboardLayer is **in use** (scratch canvas + blit to FO); per-plate FBO tiling remains a future density option. Do not merge plate ink into the world WebGL framebuffer (breaks FO between plates).

## Alternatives considered

1. **Keep SVG runtime, harden viewBox sync** — rejected; complexity grows with zoom and node count.
2. **Adopt an external whiteboard SDK** — rejected (ADR 0002); product artboards / agents / media stay in-house.
3. **Jump straight to WebGL** — rejected initially; stabilize camera + hit + chrome first. Phase 4 now defaults WebGL after SoA + hit landed.
4. **One world WebGL + transparent SVG plates for bound ink** — rejected; FO hosts would always sit above all WebGL, so selected media cannot stack between artboards.
5. **Bound idle → SVG host so ink sits above its plate** — rejected; host count scales with framed content and defeats SoA density targets.

## References

- [docs/canvas-architecture.md](../canvas-architecture.md)
- `apps/web/src/components/rcb/camera/transform.ts`
- `apps/web/src/components/rcb/canvas/RcbCanvas.tsx`
- `apps/web/src/components/rcb/frames/HtmlArtboardFrame.tsx`
- `apps/web/src/components/rcb/frames/artboardInkSurface.ts`
- `apps/web/src/components/rcb/frames/artboardWebglInk.ts`
- `apps/web/src/components/rcb/render/sceneRenderer.ts`
- `apps/web/src/components/rcb/render/sceneRenderBuffer.ts`
- `apps/web/src/components/rcb/render/renderDemotionScheduler.ts`
- `apps/web/src/components/rcb/render/webglSceneRenderer.ts`
- `apps/web/src/components/rcb/core/soaQuadtree.ts`
- `apps/web/src/components/rcb/core/spatialIndex.ts`
- `apps/web/src/components/rcb/render/soaBakeLayer.ts`
- `apps/web/src/components/rcb/render/gpuDepthOfField.ts`
- `apps/web/src/components/rcb/render/webglDepthOfFieldPass.ts`
- `apps/web/src/components/rcb/selection/SelectionChrome.tsx`
