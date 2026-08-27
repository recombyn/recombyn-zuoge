import { describe, expect, it } from 'vitest';
import {
  RCB_PLACE_TEXT_SCREEN_PX,
  rcbDefaultPlaceFontSize,
  rcbPlaceTextFontSize,
} from '../layout';
import { createTextNode } from '../../scene/document/nodeFactories';
import { parseNodeTextStyle } from '../../scene/document/sceneText';
import { snapCoordToGrid } from '../../selection/alignGuides';

describe('rcbDefaultPlaceFontSize (T-tool at zoom)', () => {
  it('default target is ~18 CSS px at 100% zoom', () => {
    expect(RCB_PLACE_TEXT_SCREEN_PX).toBe(18);
    expect(rcbDefaultPlaceFontSize(1)).toBe(18);
  });

  it('at 4000% zoom is ~1 scene px (not document-18 filling the view)', () => {
    const fs = rcbDefaultPlaceFontSize(40);
    expect(fs).toBe(1);
    expect(fs).toBeLessThan(RCB_PLACE_TEXT_SCREEN_PX);
  });

  it('at 50% zoom grows so on-screen size stays ~18 CSS px', () => {
    expect(rcbDefaultPlaceFontSize(0.5)).toBe(36);
  });

  it('createTextNode applies zoom-fitted fontSize into attrs', () => {
    const fs = rcbDefaultPlaceFontSize(40);
    const x = snapCoordToGrid(10.4, 1);
    const y = snapCoordToGrid(20.6, 1);
    const { node } = createTextNode({ x, y, text: '', autoSize: true, fontSize: fs });
    const style = parseNodeTextStyle(node.attrs || {});
    expect(node.x).toBe(10);
    expect(node.y).toBe(21);
    expect(style.fontSize).toBe(fs);
    expect(node.height).toBeLessThanOrEqual(Math.ceil(fs * 1.4) + 2);
  });

  it('empty caret chrome height must not use a document-20px floor', () => {
    const fs = rcbDefaultPlaceFontSize(20);
    const emptyH = Math.ceil(fs * 1.4);
    const oldEmptyH = Math.max(fs * 1.4, 20);
    expect(emptyH).toBeLessThan(20);
    expect(oldEmptyH).toBe(20);
  });
});

describe('rcbPlaceTextFontSize (fit-to-board inference)', () => {
  it('uses camera zoom when only part of the board is visible', () => {
    expect(rcbPlaceTextFontSize(1, undefined, { viewportWidth: 1000, docWidth: 8000 })).toBe(
      18
    );
  });

  it('infers zoom when the viewport shows the full board', () => {
    expect(
      rcbPlaceTextFontSize(0.125, undefined, { viewportWidth: 1000, docWidth: 8000 })
    ).toBe(144);
    expect(rcbPlaceTextFontSize(1, undefined, { viewportWidth: 1000, docWidth: 1000 })).toBe(
      18
    );
  });
});
