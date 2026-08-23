/** RCB canvas — shared types. */

export type RcbVec = { x: number; y: number };

export type RcbBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Camera: screen = scene * zoom + (x, y). */
export type RcbCamera = {
  x: number;
  y: number;
  zoom: number;
};

export const RCB_DEFAULT_CAMERA: RcbCamera = { x: 80, y: 60, zoom: 1 };
