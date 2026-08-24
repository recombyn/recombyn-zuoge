import { describe, expect, it } from 'vitest';
import { tidyLayoutPatches } from '../tidyLayout';

describe('tidyLayoutPatches', () => {
  it('aligns two items on a row to shared vertical center', () => {
    const patches = tidyLayoutPatches([
      { id: 'a', left: 0, top: 0, width: 40, height: 40 },
      { id: 'b', left: 120, top: 20, width: 40, height: 40 },
    ]);
    expect(patches).toEqual([
      { nodeId: 'a', patch: { y: 10 } },
      { nodeId: 'b', patch: { y: 10 } },
    ]);
  });

  it('distributes three items evenly on a row', () => {
    const patches = tidyLayoutPatches([
      { id: 'a', left: 0, top: 0, width: 40, height: 40 },
      { id: 'b', left: 90, top: 5, width: 40, height: 40 },
      { id: 'c', left: 220, top: 0, width: 40, height: 40 },
    ]);
    const byId = Object.fromEntries(patches.map((p) => [p.nodeId, p.patch]));
    expect(byId.a?.y).toBe(byId.b?.y);
    expect(byId.c?.y).toBe(byId.b?.y);
    expect(byId.b?.x).toBe(110);
  });

  it('tidies multi-row grids row by row', () => {
    const patches = tidyLayoutPatches([
      { id: 'a', left: 0, top: 0, width: 30, height: 30 },
      { id: 'b', left: 80, top: 4, width: 30, height: 30 },
      { id: 'c', left: 10, top: 100, width: 30, height: 30 },
      { id: 'd', left: 70, top: 96, width: 30, height: 30 },
    ]);
    expect(patches.length).toBeGreaterThan(0);
    const moved = new Set(patches.map((p) => p.nodeId));
    expect(moved.has('b') || moved.has('d')).toBe(true);
  });
});
