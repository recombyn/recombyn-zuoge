/**
 * Shared geometry fingerprint for Path2D cache + WebGL meshCache.
 * Zoom/dpr must NOT appear — vector caches are resolution-independent.
 */
import type { SceneNodeInput } from '@/components/rcb/sceneNode';
import { getPencilBrushPaintRev } from '@/components/rcb/tools/pencilBrushes';

export function shapeGeomFingerprint(
  node: SceneNodeInput | null | undefined,
  opts?: { width?: number; height?: number }
): string {
  if (!node) return '';
  const attrs = node.attrs || {};
  const w = Math.max(1, Number(opts?.width ?? node.width) || 1);
  const h = Math.max(1, Number(opts?.height ?? node.height) || 1);
  const key = String(node.key || '');
  const t = String(attrs.shapeType || (key === 'shape' ? 'rect' : key) || '');
  const parts = [
    'strokeTess:v4',
    'densify:v3',
    'pencilSil:v1',
    key,
    t,
    w.toFixed(2),
    h.toFixed(2),
    String(attrs.sides ?? ''),
    String(attrs.points ?? ''),
    String(attrs.cornerRadius ?? ''),
    String(attrs.radiusTL ?? attrs.tl ?? ''),
    String(attrs.radiusTR ?? attrs.tr ?? ''),
    String(attrs.radiusBR ?? attrs.br ?? ''),
    String(attrs.radiusBL ?? attrs.bl ?? ''),
    String(attrs.tl ?? ''),
    String(attrs.tr ?? ''),
    String(attrs.br ?? ''),
    String(attrs.bl ?? ''),
    String(attrs.path ?? '').slice(0, 512),
    String(attrs.closed ?? ''),
    String(attrs['ellipse-inner-ratio'] ?? attrs.innerRatio ?? ''),
    String(attrs['ellipse-arc-percent'] ?? attrs.arcPercent ?? ''),
    String(attrs['ellipse-start-deg'] ?? attrs.startDeg ?? ''),
    String(attrs['arrow-head-size'] ?? ''),
    String(attrs['border-width'] ?? attrs.strokeWidth ?? ''),
    String(attrs.strokeAlign ?? attrs['stroke-align'] ?? ''),
    String(attrs.strokeLinejoin ?? ''),
    String(attrs.strokeLinecap ?? ''),
    String(attrs.strokeMiterlimit ?? ''),
    String(attrs['stroke-enabled'] ?? ''),
    String(attrs['fill-color'] ?? attrs.fill ?? ''),
    String(attrs['fill-enabled'] ?? ''),
    String(attrs['fill-visible'] ?? ''),
    String(attrs.brushStyle ?? ''),
    String(attrs.pathPressure ?? '').slice(0, 256),
    String(attrs.pressureEnabled ?? ''),
    String(attrs.pencilOutlinePath ?? '').slice(0, 256),
    t === 'pencil' ? String(getPencilBrushPaintRev()) : '',
    String(attrs.angle ?? ''),
    String(attrs.flipX ?? ''),
    String(attrs.flipY ?? ''),
  ];
  return parts.join('|');
}
