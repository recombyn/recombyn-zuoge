import { describe, expect, it } from 'vitest';
import { starHandleSites } from '../StarShapeHandlesOverlay';
import { shapeVertexPoints } from '@/components/rcb/scene/document/sceneShapes';

describe('starHandleSites', () => {
  it('places inner radius on the right-top valley and points on the next outer corner', () => {
    const width = 200;
    const height = 160;
    const ratio = 0.28;
    const sites = starHandleSites(width, height, 5, ratio);
    const points = shapeVertexPoints('star', width, height, 5, ratio);

    expect(sites?.inner).toEqual({ x: points[1]![0], y: points[1]![1] });
    expect(sites?.outer).toEqual({ x: points[2]![0], y: points[2]![1] });
  });
});
