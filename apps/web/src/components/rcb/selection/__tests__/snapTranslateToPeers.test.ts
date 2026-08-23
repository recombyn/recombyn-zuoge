import { describe, expect, it } from 'vitest';
import { snapTranslateToPeers, smartSnapThreshold } from '../alignGuides';

describe('snapTranslateToPeers (自动吸附)', () => {
  it('nudges to peer edge within screen threshold', () => {
    const left = { left: 0, top: 0, width: 100, height: 80, guideKind: 'peer' as const };
    const right = { left: 105, top: 4, width: 40, height: 40 };
    const { box, nudgeX, guides } = snapTranslateToPeers(right, [left], 8);
    expect(nudgeX).toBe(-5);
    expect(box.left).toBe(100);
    expect(guides.some((g) => g.kind === 'align' && g.axis === 'x' && g.at === 100)).toBe(true);
  });

  it('nudges top edges together', () => {
    const a = { left: 0, top: 20, width: 100, height: 80, guideKind: 'peer' as const };
    const b = { left: 120, top: 26, width: 50, height: 40 };
    const { box, nudgeY, guides } = snapTranslateToPeers(b, [a], 8);
    expect(nudgeY).toBe(-6);
    expect(box.top).toBe(20);
    expect(guides.some((g) => g.kind === 'align' && g.axis === 'y' && g.at === 20)).toBe(true);
  });

  it('does not snap when farther than threshold', () => {
    const left = { left: 0, top: 0, width: 100, height: 80, guideKind: 'peer' as const };
    const right = { left: 120, top: 0, width: 40, height: 40 };
    const { nudgeX, nudgeY } = snapTranslateToPeers(right, [left], 8);
    expect(nudgeX).toBe(0);
    expect(nudgeY).toBe(0);
  });

  it('snaps a node outside an artboard to its boundary', () => {
    const frame = {
      left: 0,
      top: 0,
      width: 400,
      height: 300,
      guideKind: 'frame' as const,
    };
    const mover = { left: 395, top: 80, width: 10, height: 40 };
    const thr = smartSnapThreshold(1); // 8
    const { box, nudgeX } = snapTranslateToPeers(mover, [frame], thr);
    expect(nudgeX).toBe(-5);
    expect(box.left + box.width).toBe(400);
  });

  it('snaps content inside an artboard to its boundary', () => {
    const frame = {
      left: 0,
      top: 0,
      width: 400,
      height: 300,
      guideKind: 'frame' as const,
    };
    const mover = { left: 6, top: 6, width: 50, height: 40 };
    const { box, nudgeX, nudgeY } = snapTranslateToPeers(mover, [frame], 8);
    expect(nudgeX).toBe(-6);
    expect(nudgeY).toBe(-6);
    expect(box.left).toBe(0);
    expect(box.top).toBe(0);
  });
});
