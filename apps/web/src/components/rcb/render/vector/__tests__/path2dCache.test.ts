import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  clearPath2DCache,
  clearNodePathFingerprints,
  getCachedPath2D,
  getPath2DCacheSize,
  rememberNodePath2D,
  invalidateNodePath2D,
} from '@/components/rcb/scene/document/sceneShapes';
import { shapeGeomFingerprint } from '@/components/rcb/render/vector/geomFingerprint';
import type { SceneNodeInput } from '@/components/rcb/sceneNode';

describe('Path2D cache (dual-backend)', () => {
  const OrigPath2D = globalThis.Path2D;

  beforeEach(() => {
    clearPath2DCache();
    clearNodePathFingerprints();
    if (typeof globalThis.Path2D === 'undefined') {
      // happy-dom may omit Path2D — minimal stand-in for cache identity tests.
      globalThis.Path2D = class Path2D {
        d: string;
        constructor(d?: string) {
          this.d = String(d || '');
        }
      } as unknown as typeof Path2D;
    }
  });

  afterEach(() => {
    if (OrigPath2D) globalThis.Path2D = OrigPath2D;
    else delete (globalThis as { Path2D?: unknown }).Path2D;
    clearPath2DCache();
    clearNodePathFingerprints();
  });

  it('reuses Path2D for identical d (no linear growth)', () => {
    const d = 'M0 0 H40 V30 H0 Z';
    const a = getCachedPath2D(d);
    const b = getCachedPath2D(d);
    expect(a).toBeTruthy();
    expect(b).toBe(a);
    expect(getPath2DCacheSize()).toBe(1);
  });

  it('rememberNodePath2D binds node without duplicating Path2D', () => {
    const d = 'M0 0 L10 0 L10 10';
    const p1 = rememberNodePath2D('n1', d);
    const p2 = rememberNodePath2D('n2', d);
    expect(p1).toBeTruthy();
    expect(p1).toBe(p2);
    expect(getPath2DCacheSize()).toBe(1);
    invalidateNodePath2D('n1');
    expect(getCachedPath2D(d)).toBe(p2);
  });

  it('geom fingerprint change implies new path d for mesh/Path2D alignment', () => {
    const a = {
      id: 'r',
      key: 'shape',
      width: 40,
      height: 30,
      attrs: { shapeType: 'rect', cornerRadius: 0 },
    } as SceneNodeInput;
    const b = {
      ...a,
      attrs: { ...a.attrs, cornerRadius: 8 },
    } as SceneNodeInput;
    expect(shapeGeomFingerprint(a)).not.toBe(shapeGeomFingerprint(b));
  });

  it('Path2D constructor is not called again on cache hit', () => {
    let constructs = 0;
    globalThis.Path2D = class Path2D {
      constructor(_d?: string) {
        constructs += 1;
      }
    } as unknown as typeof Path2D;
    clearPath2DCache();
    const d = 'M1 1 L20 1 L20 20 Z';
    getCachedPath2D(d);
    getCachedPath2D(d);
    getCachedPath2D(d);
    expect(constructs).toBe(1);
  });
});
