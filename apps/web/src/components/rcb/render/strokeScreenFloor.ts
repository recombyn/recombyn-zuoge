/**
 * Content strokes are authored in **scene** units. Under CSS/`uZoom` camera scale,
 * `sw * zoom` can drop below 1 CSS px — WebGL coverage and SVG hairlines vanish
 * even when every shape stores the same border-width.
 *
 * Editor chrome uses a pure screen-constant width (`cssPx / zoom`). Content ink
 * keeps geometric thickness when zoomed in, and floors to ≥ `minCssPx` on screen
 * when zoomed out.
 */

/** Minimum on-screen stroke weight (CSS px) after camera scale. */
export const CONTENT_STROKE_MIN_CSS_PX = 1;

/**
 * Scene stroke width so `sw * zoom` stays ≥ `minCssPx` CSS px.
 * Returns 0 when `sceneWidth` is non-positive (no stroke).
 */
export function floorContentStrokeSceneWidth(
  sceneWidth: number,
  zoom: number,
  minCssPx = CONTENT_STROKE_MIN_CSS_PX
): number {
  const sw = Math.max(0, Number(sceneWidth) || 0);
  if (!(sw > 0)) return 0;
  const z = Math.max(0.05, Number(zoom) || 1);
  const floor = Math.max(0, Number(minCssPx) || 0) / z;
  return Math.max(sw, floor);
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
