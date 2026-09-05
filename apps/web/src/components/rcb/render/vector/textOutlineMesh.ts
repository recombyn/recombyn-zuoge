/**
 * Idle text → glyph outline fill mesh (no atlas).
 * Async outline via buildOutlinePathAsync; paint uses get when ready.
 */
import type { SceneNodeInput } from '@/components/rcb/sceneNode';
import { parseNodeText, parseNodeTextStyle } from '@/components/rcb/scene/document/sceneText';
import { buildOutlinePathAsync } from '@/components/rcb/scene/paint/outlineToPath';
import { densifyPathD } from '@/components/rcb/render/vector/contour';
import { buildCompoundFillMeshes } from '@/components/rcb/render/vector/wasmGeom';
import type { FillMesh } from '@/components/rcb/render/vector/tessellateFill';

export type CachedTextOutlineMesh = {
  fp: string;
  fill: FillMesh | null;
  fillRule: 'nonzero' | 'evenodd';
};

const cache = new Map<string, CachedTextOutlineMesh>();
const inflight = new Map<string, Promise<void>>();
const TEXT_MESH_MAX = 2048;
const touchOrder: string[] = [];

function touch(id: string) {
  const i = touchOrder.indexOf(id);
  if (i >= 0) touchOrder.splice(i, 1);
  touchOrder.push(id);
  while (touchOrder.length > TEXT_MESH_MAX) {
    const drop = touchOrder.shift();
    if (drop) cache.delete(drop);
  }
}

/** Layout + style fingerprint — must match idle text paint fields. */
export function textOutlineGeomFingerprint(
  node: SceneNodeInput,
  opts?: { width?: number; height?: number }
): string {
  const attrs = node.attrs || {};
  const style = parseNodeTextStyle(attrs);
  const w = Math.max(1, Number(opts?.width ?? node.width) || 1);
  const h = Math.max(1, Number(opts?.height ?? node.height) || 1);
  return [
    'textOutline:v1',
    parseNodeText(attrs),
    w.toFixed(2),
    h.toFixed(2),
    String(style.fontSize ?? ''),
    String(style.fontFamily ?? ''),
    String(style.fontWeight ?? ''),
    String(style.fontStyle ?? ''),
    String(style.textAlign ?? ''),
    String(style.lineHeight ?? ''),
    String(style.letterSpacing ?? ''),
    String(style.fill ?? ''),
    String(attrs.textFrame ?? ''),
    String(attrs.verticalAlign ?? ''),
    String(attrs.angle ?? ''),
  ].join('|');
}

export function invalidateTextOutlineMesh(nodeId: string) {
  const id = String(nodeId || '').trim();
  if (!id) return;
  cache.delete(id);
  inflight.delete(id);
  const i = touchOrder.indexOf(id);
  if (i >= 0) touchOrder.splice(i, 1);
}

export function clearTextOutlineMeshCache() {
  cache.clear();
  inflight.clear();
  touchOrder.length = 0;
}

export function getTextOutlineMesh(
  nodeId: string,
  node: SceneNodeInput,
  opts?: { width?: number; height?: number }
): CachedTextOutlineMesh | null {
  const id = String(nodeId || '').trim();
  if (!id || !node) return null;
  const fp = textOutlineGeomFingerprint(node, opts);
  const hit = cache.get(id);
  if (hit && hit.fp === fp && hit.fill) {
    touch(id);
    return hit;
  }
  return null;
}

/**
 * Kick async outline→mesh when missing/stale. Completes with idle paint bump.
 */
export function ensureTextOutlineMesh(
  nodeId: string,
  node: SceneNodeInput,
  opts?: { width?: number; height?: number }
): void {
  const id = String(nodeId || '').trim();
  if (!id || !node || String(node.key || '') !== 'text') return;
  const text = parseNodeText(node.attrs || {}).trim();
  if (!text) return;
  const fp = textOutlineGeomFingerprint(node, opts);
  const hit = cache.get(id);
  if (hit && hit.fp === fp) return;
  if (inflight.has(id)) return;

  const paintNode: SceneNodeInput = {
    ...node,
    id,
    width: Math.max(1, Number(opts?.width ?? node.width) || 1),
    height: Math.max(1, Number(opts?.height ?? node.height) || 1),
  };

  const job = (async () => {
    try {
      const outline = await buildOutlinePathAsync(paintNode);
      const d = String(outline?.pathD || '').trim();
      if (!d) {
        cache.set(id, { fp, fill: null, fillRule: 'evenodd' });
        touch(id);
        return;
      }
      const fillRule = outline?.fillRule === 'nonzero' ? 'nonzero' : 'evenodd';
      const points = densifyPathD(d);
      const fill = buildCompoundFillMeshes(points, fillRule);
      cache.set(id, { fp, fill, fillRule });
      touch(id);
      const { bumpSceneCanvasIdlePaint } = await import('@/components/rcb/render/sceneRenderer');
      bumpSceneCanvasIdlePaint();
    } catch (err) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn('[textOutlineMesh] build failed', id, err);
      }
      cache.set(id, { fp, fill: null, fillRule: 'evenodd' });
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, job);
}

/** Test helper: inject a ready mesh from path `d`. */
export function setTextOutlineMeshForTests(
  nodeId: string,
  node: SceneNodeInput,
  pathD: string,
  opts?: { width?: number; height?: number; fillRule?: 'nonzero' | 'evenodd' }
): CachedTextOutlineMesh | null {
  const id = String(nodeId || '').trim();
  if (!id) return null;
  const fp = textOutlineGeomFingerprint(node, opts);
  const fillRule = opts?.fillRule === 'nonzero' ? 'nonzero' : 'evenodd';
  const fill = buildCompoundFillMeshes(densifyPathD(pathD), fillRule);
  const entry: CachedTextOutlineMesh = { fp, fill, fillRule };
  cache.set(id, entry);
  touch(id);
  return entry;
}
