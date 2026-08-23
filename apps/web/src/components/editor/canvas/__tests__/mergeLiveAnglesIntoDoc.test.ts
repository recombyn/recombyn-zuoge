import { describe, expect, it } from 'vitest';
import { mergeLiveAnglesIntoDoc } from '../canvasSession';
import type { SceneDocument } from '@/components/rcb/sceneNode';

function docWithAngle(nodeId: string, angle: number): SceneDocument {
  return {
    deltaSetLike: {
      ROOT: { key: 'root', children: [nodeId] },
      [nodeId]: {
        key: 'shape',
        width: 120,
        height: 1,
        attrs: { shapeType: 'arrow', angle },
      },
    },
    frames: [],
  } as unknown as SceneDocument;
}

describe('mergeLiveAnglesIntoDoc', () => {
  it('copies preview angle from live doc onto committed base', () => {
    const committed = docWithAngle('n1', 0);
    const live = docWithAngle('n1', 45);
    const merged = mergeLiveAnglesIntoDoc(committed, live, ['n1']);
    expect(merged.deltaSetLike?.n1?.attrs?.angle).toBe(45);
    expect(committed.deltaSetLike?.n1?.attrs?.angle).toBe(0);
  });

  it('leaves base unchanged when angles already match', () => {
    const committed = docWithAngle('n1', 30);
    const live = docWithAngle('n1', 30);
    expect(mergeLiveAnglesIntoDoc(committed, live, ['n1'])).toBe(committed);
  });
});
