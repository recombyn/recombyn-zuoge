import { describe, expect, it } from 'vitest';
import { rcbDefaultPlaceFontSize } from '../layout';
import {
  createTextNode
} from '../../scene/document/nodeFactories';
import { parseNodeTextStyle } from '../../scene/document/sceneText';
import { snapCoordToGrid } from '../../selection/alignGuides';

describe('rcbDefaultPlaceFontSize (T-tool at zoom)', () => {
  it('at 100% zoom keeps ~14 scene px', () => {
    expect(rcbDefaultPlaceFontSize(1, 14)).toBe(14);
  });

  it('at 4000% zoom is ~1 scene px (not document-14 filling the view)', () => {
    const fs = rcbDefaultPlaceFontSize(40, 14);
    // eslint-disable-next-line no-console
    console.log('[test:text-font@4000%]', { fs, documentPx: 14 });
    expect(fs).toBe(1);
    expect(fs).toBeLessThan(14);
  });

  it('at 50% zoom grows so on-screen size stays ~14 CSS px', () => {
    expect(rcbDefaultPlaceFontSize(0.5, 14)).toBe(28);
  });

  it('createTextNode applies zoom-fitted fontSize into attrs', () => {
    const fs = rcbDefaultPlaceFontSize(40, 14);
    const x = snapCoordToGrid(10.4, 1);
    const y = snapCoordToGrid(20.6, 1);
    const { node } = createTextNode({ x, y, text: '', autoSize: true, fontSize: fs });
    const style = parseNodeTextStyle(node.attrs || {});
    // eslint-disable-next-line no-console
    console.log('[test:createText@4000%]', {
      fs,
      x: node.x,
      y: node.y,
      w: node.width,
      h: node.height,
      styleFs: style.fontSize,
    });
    expect(node.x).toBe(10);
    expect(node.y).toBe(21);
    expect(style.fontSize).toBe(fs);
    // Caret box should hug the small font, not a hardcoded height 20.
    expect(node.height).toBeLessThanOrEqual(Math.ceil(fs * 1.4) + 2);
  });

  it('empty caret chrome height must not use a document-20px floor', () => {
    const fs = rcbDefaultPlaceFontSize(20, 14); // 0.7 → rounds to 0.5? 14/20=0.7 → 0.5? round*2/2
    const emptyH = Math.ceil(fs * 1.4);
    const oldEmptyH = Math.max(fs * 1.4, 20);
    // eslint-disable-next-line no-console
    console.log('[test:text-empty-h]', { fs, emptyH, oldEmptyH });
    expect(emptyH).toBeLessThan(20);
    expect(oldEmptyH).toBe(20);
  });
});
