import { afterEach, describe, expect, it } from 'vitest';
import {
  clearNodeTransformPreviews,
  getNodeTransformPreview,
  setNodeTransformAngles,
} from '@/components/rcb/core/transformPreview';
import { previewSvgNodeGeometry } from '@/components/rcb/scene/paint/sceneToSvg';

afterEach(() => {
  clearNodeTransformPreviews();
});

describe('gesture preview sync surfaces', () => {
  it('previewSvgNodeGeometry with publishPreview:false leaves TransformPreview to the batch', () => {
    setNodeTransformAngles([{ nodeId: 'n1', angle: 30 }]);
    expect(getNodeTransformPreview('n1')?.angle).toBe(30);

    previewSvgNodeGeometry(new Map(), 'n1', { left: 10, top: 20, width: 40, height: 50 }, {
      publishPreview: false,
    });
    // Demoted / batch path: geom publish skipped — angle fact stays, box still from prior.
    expect(getNodeTransformPreview('n1')?.angle).toBe(30);
    expect(getNodeTransformPreview('n1')?.left).toBeNaN();
  });

  it('default publish still writes box for demoted (no host) SoA path', () => {
    const ok = previewSvgNodeGeometry(new Map(), 'soa-only', {
      left: 5,
      top: 6,
      width: 7,
      height: 8,
    });
    expect(ok).toBe(true);
    const live = getNodeTransformPreview('soa-only');
    expect(live?.left).toBe(5);
    expect(live?.top).toBe(6);
    expect(live?.width).toBe(7);
    expect(live?.height).toBe(8);
  });
});
