/** Push / pop editor camera around focused tool sessions. */

export type SessionCameraBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Stage-space chrome that shrinks the fit band (overlays on the stage). */
export type SessionCameraBandInsets = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

export type SessionCameraFitOpts = {
  padding?: number;
  maxZoom?: number;
  /** @deprecated Prefer `bandInsets.bottom`. */
  viewportHeightInset?: number;
  /** Fit + center inside this free band (stage px). */
  bandInsets?: SessionCameraBandInsets;
  /** 0 = top of free band, 1 = bottom (default 0.5). */
  bandAnchorY?: number;
};

export type SessionCameraPushDetail = {
  action: 'push';
  bounds: SessionCameraBounds;
  padding?: number;
  maxZoom?: number;
  viewportHeightInset?: number;
  bandInsets?: SessionCameraBandInsets;
  bandAnchorY?: number;
};

/** Re-center without stacking another restore snapshot. */
export type SessionCameraFitDetail = {
  action: 'fit';
  bounds: SessionCameraBounds;
  padding?: number;
  maxZoom?: number;
  viewportHeightInset?: number;
  bandInsets?: SessionCameraBandInsets;
  bandAnchorY?: number;
};

export type SessionCameraPopDetail = {
  action: 'pop';
};

export type SessionCameraDetail =
  | SessionCameraPushDetail
  | SessionCameraFitDetail
  | SessionCameraPopDetail;

export const SESSION_CAMERA_EVENT = 'resume:session-camera';

export function pushSessionCamera(
  bounds: SessionCameraBounds,
  opts?: SessionCameraFitOpts
) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<SessionCameraDetail>(SESSION_CAMERA_EVENT, {
      detail: {
        action: 'push',
        bounds,
        padding: opts?.padding,
        maxZoom: opts?.maxZoom,
        viewportHeightInset: opts?.viewportHeightInset,
        bandInsets: opts?.bandInsets,
        bandAnchorY: opts?.bandAnchorY,
      },
    })
  );
}

export function fitSessionCamera(
  bounds: SessionCameraBounds,
  opts?: SessionCameraFitOpts
) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<SessionCameraDetail>(SESSION_CAMERA_EVENT, {
      detail: {
        action: 'fit',
        bounds,
        padding: opts?.padding,
        maxZoom: opts?.maxZoom,
        viewportHeightInset: opts?.viewportHeightInset,
        bandInsets: opts?.bandInsets,
        bandAnchorY: opts?.bandAnchorY,
      },
    })
  );
}

export function popSessionCamera() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<SessionCameraDetail>(SESSION_CAMERA_EVENT, {
      detail: { action: 'pop' },
    })
  );
}
