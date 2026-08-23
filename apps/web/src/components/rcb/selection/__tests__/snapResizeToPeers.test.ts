import { describe, expect, it } from 'vitest';
import { snapResizeToPeers } from '../alignGuides';

describe('snapResizeToPeers (resize 自动吸附)', () => {
  it('snaps bottom edge to peer top within threshold', () => {
    const peer = { left: 0, top: 0, width: 200, height: 100, guideKind: 'peer' as const };
    const resized = { left: 20, top: 0, width: 80, height: 105 };
    const { box, guides } = snapResizeToPeers(resized, 's', [peer], 8);
    expect(box.top + box.height).toBe(100);
    expect(guides.some((g) => g.kind === 'align' && g.axis === 'y' && g.at === 100)).toBe(true);
  });

  it('snaps right edge to peer left within threshold', () => {
    const peer = { left: 200, top: 0, width: 100, height: 80, guideKind: 'peer' as const };
    const resized = { left: 0, top: 10, width: 195, height: 40 };
    const { box } = snapResizeToPeers(resized, 'e', [peer], 8);
    expect(box.left + box.width).toBe(200);
  });

  it('snaps moving left edge to peer right', () => {
    const peer = { left: 0, top: 0, width: 100, height: 80, guideKind: 'peer' as const };
    const resized = { left: 105, top: 0, width: 80, height: 60 };
    const { box } = snapResizeToPeers(resized, 'w', [peer], 8);
    expect(box.left).toBe(100);
    expect(box.width).toBe(85);
  });

  it('does not snap when farther than threshold', () => {
    const peer = { left: 0, top: 0, width: 100, height: 80, guideKind: 'peer' as const };
    const resized = { left: 0, top: 0, width: 80, height: 150 };
    const { box } = snapResizeToPeers(resized, 's', [peer], 8);
    expect(box.height).toBe(150);
  });
});
