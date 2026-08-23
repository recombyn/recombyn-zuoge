import { describe, expect, it } from 'vitest';
import {
  resolvePenPlaceAction,
  reversePenAnchors,
  type PenAnchor,
} from '../penPath';
import { findOpenPenEndpointResume } from '../PenDrawFeature';
import type { SceneDocument } from '@/components/rcb/sceneNode';

/**
 * Regression: re-clicking the same landing (esp. last≈first) used to close and
 * commit — next clicks started an unlinked path. Hit last/anchor before close.
 */
describe('pen place action (same landing must not break stroke)', () => {
  const anchors: PenAnchor[] = [
    { x: 10, y: 10 },
    { x: 40, y: 12 },
    { x: 12, y: 14 }, // last near first (within CLOSE_THRESHOLD=10)
  ];

  it('re-click last landing → anchor (keep linked), not close', () => {
    const action = resolvePenPlaceAction({
      anchors,
      snapped: { x: 12, y: 14 },
      raw: { x: 12.2, y: 14.1 },
      anchorHitRadius: 2,
      closeThreshold: 10,
    });
    // eslint-disable-next-line no-console
    console.log('[test:pen-place:reclick-last]', action);
    expect(action).toEqual({ kind: 'anchor', index: 2 });
  });

  it('click first landing with ≥2 points → close', () => {
    const action = resolvePenPlaceAction({
      anchors,
      snapped: { x: 10, y: 10 },
      raw: { x: 10.1, y: 9.9 },
      anchorHitRadius: 2,
      closeThreshold: 10,
    });
    // eslint-disable-next-line no-console
    console.log('[test:pen-place:click-first]', action);
    expect(action).toEqual({ kind: 'close' });
  });

  it('empty near first (not on first disc) still places — keeps stroke linked', () => {
    const action = resolvePenPlaceAction({
      anchors,
      snapped: { x: 9, y: 9 },
      raw: { x: 9, y: 9 },
      anchorHitRadius: 0.5,
      closeThreshold: 10,
    });
    // eslint-disable-next-line no-console
    console.log('[test:pen-place:near-first]', action);
    expect(action).toEqual({ kind: 'place', x: 9, y: 9 });
  });

  it('new cell far from ends → place', () => {
    const action = resolvePenPlaceAction({
      anchors,
      snapped: { x: 80, y: 80 },
      raw: { x: 80.2, y: 79.7 },
      anchorHitRadius: 2,
      closeThreshold: 10,
    });
    // eslint-disable-next-line no-console
    console.log('[test:pen-place:new]', action);
    expect(action).toEqual({ kind: 'place', x: 80, y: 80 });
  });

  it('full flow: A→B→C(near A)→reclick C stays open; only click A closes', () => {
    let list: PenAnchor[] = [];
    const clicks = [
      { x: 10, y: 10 },
      { x: 40, y: 10 },
      { x: 12, y: 12 },
      { x: 12, y: 12 }, // re-click last
    ];
    const kinds: string[] = [];
    for (const c of clicks) {
      const action = resolvePenPlaceAction({
        anchors: list,
        snapped: c,
        raw: c,
        anchorHitRadius: 2,
        closeThreshold: 10,
      });
      kinds.push(action.kind);
      if (action.kind === 'place') list = [...list, { x: action.x, y: action.y }];
      if (action.kind === 'close') break;
    }
    // eslint-disable-next-line no-console
    console.log('[test:pen-place:flow]', { kinds, list });
    expect(kinds).toEqual(['place', 'place', 'place', 'anchor']);
    expect(list).toHaveLength(3);

    const close = resolvePenPlaceAction({
      anchors: list,
      snapped: { x: 10, y: 10 },
      raw: { x: 10, y: 10 },
      anchorHitRadius: 2,
      closeThreshold: 10,
    });
    expect(close.kind).toBe('close');
  });
});

describe('resume open pen from endpoint (link later stroke)', () => {
  it('click near open end loads that stroke (not a fresh path)', () => {
    const document = {
      deltaSetLike: {
        pen1: {
          key: 'shape',
          x: 0,
          y: 0,
          width: 50,
          height: 20,
          attrs: {
            shapeType: 'pen',
            path: 'M 0 0 L 40 0 L 40 10',
            closed: 'false',
            'stroke-enabled': 'true',
            'border-width': 1,
          },
        },
      },
    } as unknown as SceneDocument;
    const hit = findOpenPenEndpointResume(document, 40, 10, 10);
    // eslint-disable-next-line no-console
    console.log('[test:pen-resume:end]', hit);
    expect(hit?.nodeId).toBe('pen1');
    expect(hit?.anchors[hit.anchors.length - 1]).toEqual({ x: 40, y: 10 });
    expect(hit?.anchors).toHaveLength(3);
  });

  it('click near open start reverses so append continues from that end', () => {
    const document = {
      deltaSetLike: {
        pen1: {
          key: 'shape',
          x: 5,
          y: 5,
          width: 50,
          height: 20,
          attrs: {
            shapeType: 'pen',
            path: 'M 0 0 L 30 0',
            closed: 'false',
          },
        },
      },
    } as unknown as SceneDocument;
    // nodeLeftTop uses x/y → scene anchors at (5,5)-(35,5)
    const hit = findOpenPenEndpointResume(document, 5, 5, 8);
    // eslint-disable-next-line no-console
    console.log('[test:pen-resume:start]', hit);
    expect(hit?.nodeId).toBe('pen1');
    expect(hit?.anchors[hit.anchors.length - 1]).toEqual({ x: 5, y: 5 });
    expect(hit?.anchors[0]).toEqual({ x: 35, y: 5 });
  });

  it('closed path is not resumed', () => {
    const document = {
      deltaSetLike: {
        pen1: {
          key: 'shape',
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          attrs: {
            shapeType: 'pen',
            path: 'M 0 0 L 10 0 L 10 10 Z',
            closed: 'true',
          },
        },
      },
    } as unknown as SceneDocument;
    const hit = findOpenPenEndpointResume(document, 10, 10, 10);
    // eslint-disable-next-line no-console
    console.log('[test:pen-resume:closed]', hit);
    expect(hit).toBeNull();
  });

  it('reversePenAnchors swaps in/out handles', () => {
    const rev = reversePenAnchors([
      { x: 0, y: 0, outX: 2, outY: 0 },
      { x: 10, y: 0, inX: 8, inY: 0 },
    ]);
    // eslint-disable-next-line no-console
    console.log('[test:pen-reverse]', rev);
    expect(rev[0]).toEqual({ x: 10, y: 0, outX: 8, outY: 0 });
    expect(rev[1]).toEqual({ x: 0, y: 0, inX: 2, inY: 0 });
  });
});
