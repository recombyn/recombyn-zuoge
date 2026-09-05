/**
 * RCB standard canvas API — HitTest facade.
 */
export {
  hitTestSceneAtPoint,
  hitTestUnifiedStackAtPoint,
  hitTestSceneNodeAt,
  frameIdAtPoint,
  isNodePickableAtPoint,
  isOccludedByHigherArtboard,
  listHigherArtboardOccluderBoxes,
  subtractHigherArtboardOccluders,
  isNodeAabbFullyOccludedByHigherArtboard,
  setSceneHitTestBridge,
  attachViewportToolPointers,
  type HitTestSceneAtPointOpts,
  type SceneStackHit,
  type SceneStackHitKind,
  type SceneOccluderBox,
} from '@/components/rcb/scene/document/sceneHitBridge';

export {
  hitTestWithSpatialIndex,
  hitTestSceneTargetWithSpatialIndex,
  collectUnifiedHitCandidates,
} from '@/components/rcb/render/sceneRenderer';

export {
  hitTestSoaBuffer,
  hitTestSoaBufferOrdered,
  hitTestSoaSlot,
} from '@/components/rcb/render/sceneRenderBuffer';
