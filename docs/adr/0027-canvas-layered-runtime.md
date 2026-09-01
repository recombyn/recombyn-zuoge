# ADR 0027: Scene + camera + layered render + independent hit

- **Status:** Accepted
- **Date:** 2026-08-15
- **Supersedes (partial):** [ADR 0002](./0002-canvas-rcb-runtime.md) runtime paint/hit coupling — RCB ownership stays; SVG is no longer the editor runtime fact layer.

## Context

RCB already owns `SceneDocument`, camera math (`rcb/core/math.ts`), and `SceneSpatialRuntime`. Live editing still couples **paint, hit-testing, and selection chrome** through SVG/DOM:

- One world layer drives SVG + HTML via CSS `translate + scale`.
- Selection chrome / path handles mirror host `viewBox` and use `1/zoom` counter-scale.
- Frequent `querySelector` / `getBoundingClientRect` / multi-surface z-index sync drifts under pan, zoom (5%–10_000%), and dense scenes.

SVG remains fine for export and moderate static paint. It must not remain the interaction and control-box substrate.

## Decision

Treat the editor runtime as four facts (**this is the product architecture — do not invent a parallel one mid-fix**):

1. **`SceneDocument`** — unique document source of truth (store / collab patches write here).
2. **`CameraTransform`** — single pan/zoom matrix; only `worldToScreen` / `screenToWorld` / `screenDeltaToWorldDelta` on hot paths. No DOM “correction” of coordinates during gestures.
3. **Layered render** — committed ink: SVG hosts for rich/media; **default-on Canvas2D SoA** idle ink (kill-switch `VITE_SOA_CANVAS_SHAPES=0`); opt-in WebGL2 remains frozen; grid on Canvas underlay. Selection, guides, and drawing previews share the camera surface; screen UI stays in the HTML overlay.
4. **Independent hit** — root pointer capture → chrome hit → spatial index coarse → precise geometry. `sceneToSvg` stays an **export** path, not the live paint core.

SVG is not the editor runtime fact layer. Fact layer = `SceneDocument` + `CameraTransform` + `SceneSpatialRuntime`.

### Delivery roadmap (phased — no rewrite)

| Phase | Status | Goal |
|-------|--------|------|
| 1 | Done (core) | CameraTransform API; ink and selection chrome share the same SVG root and camera `<g>`; geometry-first chrome hit; shared spatial; union AABB chrome. |
| 2 | Done (core) | `SceneRenderer` (`svg` + `canvas2d` underlay); idle Canvas ink (`canIdlePaintOnCanvas` + rounded/poly Path2D). |
| 3 | Done (default-on) | **SoA** `SceneRenderBuffer` default-on Canvas2D (`VITE_SOA_CANVAS_SHAPES=0` kill-switch); radii + center outline stroke + simple poly/star samples; promote/demote; AI lock → one flush; spatial from SoA; dirty AABB; bake ≥8k. Gradient / non-center strokeAlign / text / media stay SVG (rich Canvas only on host-budget overflow). |
| 4 | Frozen (opt-in) | WebGL2 instancing + path densify + atlas — **not** product default. Outline stroke / poly stay on SVG while WebGL is on (instances lack those). Flags: `VITE_SOA_WEBGL=1`. Converge later; do not dual-default. |

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

### Negative / trade-offs

- Dual paint paths (`SvgRenderer` + Canvas underlay) until migration completes.
- Contributors must not add new world-layer control SVG that mirrors host `viewBox`.

## Alternatives considered

1. **Keep SVG runtime, harden viewBox sync** — rejected; complexity grows with zoom and node count.
2. **Adopt an external whiteboard SDK** — rejected (ADR 0002); product artboards / agents / media stay in-house.
3. **Jump straight to WebGL** — rejected; stabilize camera + hit + chrome first.

## References

- [docs/canvas-architecture.md](../canvas-architecture.md)
- `apps/web/src/components/rcb/camera/transform.ts`
- `apps/web/src/components/rcb/render/sceneRenderer.ts`
- `apps/web/src/components/rcb/core/spatialIndex.ts`
- `apps/web/src/components/rcb/selection/SelectionChrome.tsx`
