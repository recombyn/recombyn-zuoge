/**
 * Content strokes are authored in **scene** units and scale with the camera.
 * No on-screen hairline floor, no hard cull, no zoom-out thickening — paint
 * the geometric width; far zoom may drop below 1 CSS px uniformly.
 *
 * `floorContentStrokeSceneWidth` keeps the historic name/signature for callers
 * (WebGL / SVG / atlas bake) but returns geometric scene width unchanged.
 */

/** @deprecated Content ink no longer floors to a minimum CSS px. Kept as 0. */
export const CONTENT_STROKE_MIN_CSS_PX = 0;

/**
 * Scene stroke width for paint. Returns geometric `sceneWidth` (no screen floor
 * / no CSS-px quantization). Optional `minCssPx` is ignored when <= 0; when > 0
 * it still lifts `sw` so `sw * zoom >= minCssPx` (chrome / tests only).
 * Returns 0 when `sceneWidth` is non-positive (no stroke).
 */
export function floorContentStrokeSceneWidth(
  sceneWidth: number,
  zoom: number,
  minCssPx = CONTENT_STROKE_MIN_CSS_PX
): number {
  const sw = Math.max(0, Number(sceneWidth) || 0);
  if (!(sw > 0)) return 0;
  const minCss = Math.max(0, Number(minCssPx) || 0);
  if (!(minCss > 0)) return sw;
  const z = Math.max(0.05, Number(zoom) || 1);
  return Math.max(sw, minCss / z);
}

/**
 * Cap path segment emission when zoomed out — dense boolean outlines otherwise
 * explode the instance batch while screen coverage is already a hairline.
 */
export function adaptivePathStrokeMaxSegs(zoom: number, cap = 96): number {
  const z = Math.max(0.05, Number(zoom) || 1);
  const hard = Math.max(8, Math.floor(Number(cap) || 96));
  if (z >= 0.75) return hard;
  if (z >= 0.4) return Math.max(24, Math.floor(hard * 0.5));
  if (z >= 0.2) return Math.max(16, Math.floor(hard * 0.33));
  return Math.max(12, Math.floor(hard * 0.2));
}
