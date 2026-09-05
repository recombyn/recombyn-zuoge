/**
 * RCB standard canvas API — Scene facade (spatial + SoA buffer).
 */
export {
  RcbSpatialIndex,
  SceneSpatialRuntime,
  boxesIntersect,
  nodeSceneAabb,
  getSharedSceneSpatialRuntime,
  setSharedSceneSpatialRuntime,
  type RcbSpatialItem,
} from '@/components/rcb/core/spatialIndex';

export { SoaQuadtree, type SoaQuadItem } from '@/components/rcb/core/soaQuadtree';

export {
  createSceneRenderBuffer,
  syncSceneRenderBufferFromDocument,
  syncSceneRenderBufferIncremental,
  getSharedSceneRenderBuffer,
  resetSharedSceneRenderBuffer,
  isSoaCanvasShapesEnabled,
  isSoaWebglEnvEnabled,
  isSoaCanvasEligible,
  isSoaBasicGeomSufficient,
  forEachVisibleInRect,
  applySoaHostInkFlags,
  markSoaDirty,
  markSoaDirtyById,
  markAllSoaDirty,
  type SceneRenderBuffer,
} from '@/components/rcb/render/sceneRenderBuffer';

export {
  clearNodeTransformPreviews,
  effectivePaintBox,
  getNodeTransformPreview,
  hasNodeTransformPreviews,
  setNodeTransformPreviews,
  subscribeTransformPreview,
  type EffectivePaintBox,
  type NodeTransformPreview,
} from '@/components/rcb/core/transformPreview';
