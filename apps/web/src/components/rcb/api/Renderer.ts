/**
 * RCB standard canvas API — Renderer facade.
 *
 * Sharpness (Figma-aligned): restamp / artboard tiles at zoom×dpr.
 * DomHost is obligatory only — not the sharpness path.
 * See docs/FIGMA_INK_PLAN.md and docs/CANVAS_GUIDE.md.
 */
export {
  createSceneRenderer,
  createSvgSceneRenderer,
  createCanvasSceneRenderer,
  resolveIdleInkBackend,
  canIdlePaintOnCanvas,
  paintCanvasIdleNode,
  type SceneRenderer,
  type SceneRendererBackend,
  type InkBackend,
  toInkBackend,
  shapeInkForbidsAtlas,
} from '@/components/rcb/render/sceneRenderer';

export {
  createWebglSceneRenderer,
  collectSoaWebglInstances,
} from '@/components/rcb/render/webglSceneRenderer';

export {
  SOA_ATLAS_CELL,
  SOA_ATLAS_INNER,
  atlasZoomBucket,
  atlasCoverageBucket,
  idleMediaScreenEdgePx,
  idleMediaNeedsSharpHost,
} from '@/components/rcb/render/webglInstanceAtlas';

export {
  shouldUseSoaBake,
  setSoaCameraGestureActive,
  isSoaCameraGestureActive,
  tilesForView,
  ensureSoaBake,
} from '@/components/rcb/render/soaBakeLayer';

export {
  pickFullAndCanvasIds,
  nodeNeedsDomShapeHost,
} from '@/components/rcb/shapes/RcbShapesLayer';

/**
 * Target sole paint router (Phase C). Until `paintIntent.ts` lands, resolve
 * via pickFullAndCanvasIds + canIdlePaintOnCanvas + atlas gates.
 */
export type PaintIntent =
  | { kind: 'gpu-instance' }
  | { kind: 'atlas-stamp'; zoomBucket: number }
  | { kind: 'artboard-tile' }
  | { kind: 'dom-obligatory'; reason: string };
