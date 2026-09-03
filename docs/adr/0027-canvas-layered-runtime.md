# ADR 0027: Scene + camera + layered render + independent hit

- **Status:** Accepted
- **Date:** 2026-08-15
- **Updated:** 2026-09-03 — Seven layers; WebGL-only ink + atlas outline stamps; Worker-only bake; no SoA/WebGL/atlas env kill-switches; text/media stay DOM until WebGL owns them; DOF one resolved backend
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
3. **Layered render** — **WebGL2 instanced SoA ink** (only product ink path); DOM hosts only for text / media FO / SoftGlow / editors / heavy paths; **grid** stays on a separate Canvas2D surface (not an ink fallback); selection, guides, and drawing previews share the camera surface; screen UI stays in the HTML overlay. SoftGlow/editors use `RenderDemotionScheduler` (`ACTIVE_SVG` → `CANDIDATE` → `DEPLOYED_SOA`); selection does **not** promote basic shapes onto SVG. There is **no** Canvas2D idle-ink / pan-blit / bake-blit dual path.
4. **Independent hit** — root pointer capture → chrome hit → spatial index coarse → precise geometry. `sceneToSvg` stays an **export** path, not the live paint core.

SVG is not the editor runtime fact layer. Fact layer = `SceneDocument` + `CameraTransform` + `SceneSpatialRuntime`. SoA (`SceneRenderBuffer` + `SoaQuadtree`) is a **derived** paint/pick cache and must not write back into SceneDocument. Demotion host-release uses one shared wake over `lastActive` timestamps; TransformPreview uses dirty AABB + live filter + threshold rebuild (not per-frame QT upsert).

### Seven necessary product layers (density / interaction)

Do not sell micro-caches or effects as parallel “optimization schemes.” Product narrative is these seven:

| # | Layer | Role |
|---|--------|------|
| 1 | SoA `SceneRenderBuffer` | Typed-array paint/pick cache |
| 2 | Demotion + host viewport cull | DOM budget; who stays SVG vs SoA |
| 3 | WebGL2 instancing + atlas | Only ink backend (no C2D dual path) |
| 4 | Viewport tile bake + Worker | Second wall when idle+basic ≥ ~800; live fill until tiles ready |
| 5 | Select raise keep-bake + overpaint | Select must not disable bake |
| 6 | Dirty AABB + SoA QT + incremental sync | Avoid O(N) wipe/rebuild |
| 7 | Independent hit + camera | Architecture; not an FPS knob |

**Embedded (not separate products):** path densify, AI mutation lock, TransformPreview live filter.

**Not a fallback:** Canvas2D is used for the **pixel grid surface** and Vitest paint helpers only. Product idle ink is WebGL (WebGPU only when DOF effect is on). Missing WebGL2 is a hard error — do not silently downgrade to Canvas2D ink.

**Do not merge:** `SceneSpatialRuntime` (all-node hit) vs `buf.quadtree` (idle paint/pick) — intentional dual track.

**Camera gesture:** while `cameraMoving`, skip Worker bake; live WebGL fills the viewport; bake resumes on settle.

### Delivery roadmap (phased — no rewrite)

| Phase | Status | Goal |
|-------|--------|------|
| 1 | Done (core) | CameraTransform API; ink and selection chrome share the same SVG root and camera `<g>`; geometry-first chrome hit; shared spatial; union AABB chrome. |
| 2 | Done (core) | `SceneRenderer` (`svg` hosts + `canvas2d` grid); canvas-capable vectors on idle ink (`canIdlePaintOnCanvas` + rounded/poly Path2D). |
| 3 | Done (default-on) | **SoA** `SceneRenderBuffer` always on in product (Vitest override only); WebGL vector ink + atlas (incl. stroked rect/ellipse); path samples; **text / image / video / audio** stay DOM hosts until WebGL stamps them; selected video/audio keep one FO each; AI lock → one flush; shared spatial from SoA; dirty AABB; **quadtree** idle cull; demotion + freeSlots / bulk sync. Lottie / SoftGlow / pen editors / heavy paths stay DOM hosts. |
| 4 | Done (default-on) | WebGL2 instancing + atlas — **only** product ink path. Viewport bake ≥800 eligible idle+basic → **Worker only**; incomplete maps keep live instances; camera gesture skips bake. |
| 5 | Opt-in **effect** (not density roadmap) | **GPU realtime depth-of-field** (`VITE_GPU_DOF=1`): one resolved backend (webgpu *or* webgl2), no create-time cross-fallback. Skips CPU tile bake while active. UI: Effects → Scene depth of field. |

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

- Two spatial consumers remain intentional: `SceneSpatialRuntime` (product hit / all nodes) and `buf.quadtree` (idle SoA paint/pick). Keep them in sync on demotion wake via id-scoped patches, not full-buffer upserts when N is large. **Paste / dupe membership growth** uses `restamp` + dirty rescue (compact when dirty &gt; 512); do not `bulkUpsert`/rebuild the whole tree on every Ctrl+V of overlapping stacks.
- Paste undo is `HistoryAdd` (O(paste)), not a full-document history snap. Dock chrome wakes on deferred `documentRevision` after paint — not on `sceneRevision` during the SoA commit.
- Contributors must not add new world-layer control SVG that mirrors host `viewBox`.
- Do not reintroduce dual attr keys (`fill` vs `fill-color`, frame `kind: 'lottie'`, `lottieFrameHost`, axios-shaped error probes).
- Do not add a second async bake scheduler alongside Worker (no idle/main-thread bake dual path).

## Alternatives considered

1. **Keep SVG runtime, harden viewBox sync** — rejected; complexity grows with zoom and node count.
2. **Adopt an external whiteboard SDK** — rejected (ADR 0002); product artboards / agents / media stay in-house.
3. **Jump straight to WebGL** — rejected initially; stabilize camera + hit + chrome first. Phase 4 now defaults WebGL after SoA + hit landed.

## References

- [docs/canvas-architecture.md](../canvas-architecture.md)
- `apps/web/src/components/rcb/camera/transform.ts`
- `apps/web/src/components/rcb/render/sceneRenderer.ts`
- `apps/web/src/components/rcb/render/sceneRenderBuffer.ts`
- `apps/web/src/components/rcb/render/renderDemotionScheduler.ts`
- `apps/web/src/components/rcb/core/soaQuadtree.ts`
- `apps/web/src/components/rcb/core/spatialIndex.ts`
- `apps/web/src/components/rcb/render/soaBakeLayer.ts`
- `apps/web/src/components/rcb/render/gpuDepthOfField.ts`
- `apps/web/src/components/rcb/render/webglDepthOfFieldPass.ts`
- `apps/web/src/components/rcb/render/webgpuSceneRenderer.ts`
- `apps/web/src/components/rcb/selection/SelectionChrome.tsx`
