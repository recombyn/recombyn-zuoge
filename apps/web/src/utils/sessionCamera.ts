/** Push / pop editor camera around focused tool sessions. */

export type SessionCameraBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SessionCameraPushDetail = {
  action: 'push';
  bounds: SessionCameraBounds;
  padding?: number;
  maxZoom?: number;
};

export type SessionCameraPopDetail = {
  action: 'pop';
};

export type SessionCameraDetail = SessionCameraPushDetail | SessionCameraPopDetail;

export const SESSION_CAMERA_EVENT = 'resume:session-camera';

export function pushSessionCamera(
  bounds: SessionCameraBounds,
  opts?: { padding?: number; maxZoom?: number }
) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<SessionCameraDetail>(SESSION_CAMERA_EVENT, {
      detail: {
        action: 'push',
        bounds,
        padding: opts?.padding,
        maxZoom: opts?.maxZoom,
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
