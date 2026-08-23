/**
 * Hit zones — SVG CTM circles (chrome); HTML GBR kept for painted pads.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  hitZoneFromEventTarget,
  pickPaintedHitZone,
  RCB_HIT_ZONE_ATTR,
} from '../SelectionChrome';

function mountHtmlZone(key: string, cx: number, cy: number, diameter: number) {
  const el = document.createElement('div');
  el.setAttribute(RCB_HIT_ZONE_ATTR, key);
  const half = diameter / 2;
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({
      left: cx - half,
      top: cy - half,
      right: cx + half,
      bottom: cy + half,
      width: diameter,
      height: diameter,
      x: cx - half,
      y: cy - half,
      toJSON: () => ({}),
    }),
  });
  document.body.appendChild(el);
  return el;
}

function mountSvgZone(key: string, cx: number, cy: number, r: number) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '400');
  svg.setAttribute('height', '400');
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute(RCB_HIT_ZONE_ATTR, key);
  circle.setAttribute('cx', String(cx));
  circle.setAttribute('cy', String(cy));
  circle.setAttribute('r', String(r));
  // Identity CTM in test: map user units 1:1 to client.
  Object.defineProperty(circle, 'getScreenCTM', {
    value: () => ({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
    }),
  });
  svg.appendChild(circle);
  document.body.appendChild(svg);
  return circle;
}

describe('pickPaintedHitZone (HTML div pads)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('hits resize yellow by HTML GBR center', () => {
    mountHtmlZone('resize-se', 100, 200, 16);
    const pick = pickPaintedHitZone(102, 201);
    expect(pick?.kind).toBe('resize');
    if (pick?.kind === 'resize') expect(pick.handle).toBe('se');
  });

  it('prefers resize over overlapping rotate', () => {
    mountHtmlZone('resize-se', 100, 100, 20);
    mountHtmlZone('rot-se', 105, 105, 20);
    const pick = pickPaintedHitZone(102, 102);
    expect(pick?.kind).toBe('resize');
  });

  it('misses when outside yellow', () => {
    mountHtmlZone('resize-se', 100, 100, 8);
    expect(pickPaintedHitZone(120, 120)).toBeNull();
  });

  it('hitZoneFromEventTarget reads the pad under the pointer', () => {
    const el = mountHtmlZone('radius-tl', 50, 50, 16);
    expect(hitZoneFromEventTarget(el)?.kind).toBe('radius');
  });

  it('picks pen-anchor keys', () => {
    mountHtmlZone('pen-anchor-0-3', 50, 50, 16);
    const pick = pickPaintedHitZone(50, 50);
    expect(pick?.kind).toBe('pen-anchor');
    if (pick?.kind === 'pen-anchor') {
      expect(pick.sub).toBe(0);
      expect(pick.index).toBe(3);
    }
  });
});

describe('pickPaintedHitZone (SVG circles)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('hits resize yellow by SVG CTM center', () => {
    mountSvgZone('resize-ne', 100, 200, 8);
    const pick = pickPaintedHitZone(102, 201);
    expect(pick?.kind).toBe('resize');
    if (pick?.kind === 'resize') expect(pick.handle).toBe('ne');
  });

  it('hitZoneFromEventTarget reads SVG circle', () => {
    const el = mountSvgZone('radius-tr', 40, 40, 6);
    expect(hitZoneFromEventTarget(el)?.kind).toBe('radius');
  });
});
