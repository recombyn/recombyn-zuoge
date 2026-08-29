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

  it('prefers center-to-center over corner-to-center when both are near', () => {
    const peer = {
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      guideKind: 'peer' as const,
    };
    // Centers 2px apart; left edge 3px from peer mid. Mid bias should pick centers.
    const mover = { left: 47, top: 47, width: 10, height: 10 };
    const { box, nudgeX, nudgeY } = snapTranslateToPeers(mover, [peer], 8);
    expect(box.left + box.width / 2).toBe(50);
    expect(box.top + box.height / 2).toBe(50);
    expect(nudgeX).toBe(-2);
    expect(nudgeY).toBe(-2);
  });

  it('snaps content center to artboard midline (not edge-to-mid)', () => {
    const frame = {
      left: 0,
      top: 0,
      width: 400,
      height: 400,
      guideKind: 'frame' as const,
    };
    // Center 5px off the crosshair; left edge is 45px from mid (outside thr).
    const mover = { left: 155, top: 155, width: 80, height: 80 };
    const { box, nudgeX, nudgeY, guides } = snapTranslateToPeers(mover, [frame], 8);
    expect(box.left + box.width / 2).toBe(200);
    expect(box.top + box.height / 2).toBe(200);
    expect(nudgeX).toBe(5);
    expect(nudgeY).toBe(5);
    expect(guides.some((g) => g.kind === 'align' && g.axis === 'x' && g.at === 200)).toBe(
      true
    );
  });

  it('does not snap artboard edge to midline (no corner-to-mid)', () => {
    const frame = {
      left: 0,
      top: 0,
      width: 400,
      height: 400,
      guideKind: 'frame' as const,
    };
    // Left edge 4px from mid; center is 44px away — must not suck the edge onto mid.
    const mover = { left: 196, top: 100, width: 80, height: 40 };
    const { nudgeX, guides } = snapTranslateToPeers(mover, [frame], 8);
    expect(nudgeX).toBe(0);
    expect(guides.some((g) => g.kind === 'align' && g.axis === 'x' && g.at === 200)).toBe(
      false
    );
  });
});
