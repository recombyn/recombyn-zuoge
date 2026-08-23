import { describe, expect, it } from 'vitest';
import {
  parseAndValidateSceneJson,
  validateSceneDocument,
} from '@/components/rcb/sceneNode';

describe('SceneDocument Zod boundary', () => {
  it('accepts a minimal valid document', () => {
    const result = validateSceneDocument({
      width: 794,
      height: 1123,
      deltaSetLike: {
        ROOT: { children: ['n1'] },
        n1: { key: 'shape', x: 0, y: 0, width: 10, height: 10 },
      },
    });
    expect(result.valid).toBe(true);
  });

  it('accepts video / lottie keys (not only text|shape|image)', () => {
    const result = validateSceneDocument({
      width: 800,
      height: 600,
      deltaSetLike: {
        ROOT: { children: ['v1'] },
        v1: { key: 'video', x: 0, y: 0, width: 100, height: 80, attrs: { src: 'x' } },
      },
    });
    expect(result.valid).toBe(true);
  });

  it('rejects missing ROOT / size', () => {
    expect(validateSceneDocument({ width: 100, height: 100, deltaSetLike: {} }).valid).toBe(
      false
    );
    expect(
      validateSceneDocument({
        deltaSetLike: { ROOT: { children: [] } },
      }).valid
    ).toBe(false);
  });

  it('parseAndValidateSceneJson rejects invalid JSON', () => {
    const bad = parseAndValidateSceneJson('{not json');
    expect(bad.valid).toBe(false);
    if (bad.valid === false) expect(bad.error).toMatch(/JSON/i);
  });
});
