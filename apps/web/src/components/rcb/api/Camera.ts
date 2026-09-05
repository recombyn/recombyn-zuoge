/**
 * RCB standard canvas API — Camera facade.
 */
export {
  RCB_MIN_ZOOM,
  RCB_MAX_ZOOM,
  rcbClampZoom,
  rcbCameraCssZoom,
  rcbCameraScreenOffset,
  rcbViewportMetrics,
  rcbClientToStageLocal,
  rcbSceneToScreen,
  rcbScreenToScene,
  rcbClientDeltaToScene,
  rcbResolveViewportEl,
  rcbScreenPxToScene,
  rcbZoomAtPoint,
  rcbFitCamera,
  rcbFitCameraInBand,
  rcbCenterCameraInBand,
  rcbViewportSceneBounds,
  rcbStepZoom,
} from '@/components/rcb/core/math';

export {
  createCameraTransform,
  worldToScreen,
  stageLocalToWorld,
  screenDeltaToWorldDelta,
  worldBoxToScreen,
  cameraZoom,
  cameraPan,
  type CameraTransform,
} from '@/components/rcb/camera/transform';

export {
  RcbCameraContext,
  RcbCameraMotionContext,
  RcbOverlayRootContext,
  RcbViewportElContext,
  RcbDevicePixelRatioContext,
  useRcbCamera,
  useRcbCameraMotion,
  useRcbOverlayRoot,
  useRcbViewportEl,
  useRcbDevicePixelRatio,
  useRcbScreenToScene,
  useRcbScreenToolbarStyle,
  RcbOverlayPortal,
  type RcbCameraMotion,
} from '@/components/rcb/camera/context';

export type { RcbCamera, RcbBox, RcbVec } from '@/components/rcb/core/types';
export { RCB_DEFAULT_CAMERA } from '@/components/rcb/core/types';
