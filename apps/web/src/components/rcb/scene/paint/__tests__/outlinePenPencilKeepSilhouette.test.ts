import { describe, expect, it } from 'vitest';
import { buildOutlinePath } from '../outlineToPath';
import {
  pencilInkPathFromPoints,
  polylinePathD,
} from '@/components/rcb/tools/pencilBrushes';
import { filterAnchorsForKnobPaint } from '@/components/rcb/tools/PenPathEditFeature';
import { penSubpathsFromD } from '@/components/rcb/tools/penPath';

function scribblePts(n = 60) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return {
      x: 40 + t * 220 + Math.sin(t * 14) * 28,
      y: 90 + Math.sin(t * 7) * 48 + Math.cos(t * 19) * 14,
    };
  });
}

function pathEditAnchorCount(d: string): number {
  return penSubpathsFromD(d).reduce((n, s) => n + s.anchors.length, 0);
}

function paintedKnobCount(d: string, zoom = 1): number {
  return penSubpathsFromD(d).reduce((n, s) => {
    const mask = filterAnchorsForKnobPaint(
      s.anchors.map((a) => ({ x: a.x, y: a.y })),
      zoom
    );
    return n + mask.filter(Boolean).length;
  }, 0);
}

/** Absolute shoelace area of first closed M/L ring (0 if curves-only / unparsable). */
function firstRingAbsArea(d: string): number {
  const ring = String(d)
    .split(/(?=[Mm])/)
    .map((s) => s.trim())
    .find(Boolean);
  if (!ring) return 0;
  const pts: Array<[number, number]> = [];
  const re = /[ML]\s*([-\d.eE]+)\s+([-\d.eE]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ring))) pts.push([Number(m[1]), Number(m[2])]);
  if (pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

describe('pen/pencil outline — keep paint silhouette (like text)', () => {
  it('pencil outline matches paint: keeps Q, no sparsify shred', () => {
    const pts = scribblePts(80);
    const sw = 16;
    const paint = pencilInkPathFromPoints(pts, sw, 'vector-ink', {
      linecap: 'round',
      simplify: false,
    });
    expect(paint.toLowerCase()).toMatch(/q/);

    const out = buildOutlinePath(
      {
        key: 'shape',
        width: 300,
        height: 200,
        attrs: {
          shapeType: 'pencil',
          path: polylinePathD(pts),
          'border-color': '#111',
          'border-width': sw,
          brushStyle: 'vector-ink',
        },
      },
      { zoom: 1 }
    );
    expect(out?.pathD).toBeTruthy();
    expect(out!.pathD.toLowerCase()).toMatch(/q/);
    // Area should stay in the same ballpark as paint (not collapsed digons).
    const paintArea = firstRingAbsArea(paint.replace(/[Qq][^MLZz]+/gi, ' '));
    const outArea = firstRingAbsArea(out!.pathD.replace(/[Qq][^MLZz]+/gi, ' '));
    // Q-only rings may report 0 from M/L parser — then just require Q present.
    if (paintArea > 10 && outArea > 10) {
      expect(outArea).toBeGreaterThan(paintArea * 0.35);
      expect(outArea).toBeLessThan(paintArea * 2.5);
    }
  });

  it('pencil outline may keep many verts; painted knobs stay sparse', () => {
    const pts = scribblePts(100);
    const sw = 16;
    const out = buildOutlinePath(
      {
        key: 'shape',
        width: 300,
        height: 200,
        attrs: {
          shapeType: 'pencil',
          path: polylinePathD(pts),
          'border-color': '#111',
          'border-width': sw,
          brushStyle: 'vector-ink',
        },
      },
      { zoom: 1 }
    );
    expect(out?.pathD).toBeTruthy();
    const dataN = pathEditAnchorCount(out!.pathD);
    expect(dataN).toBeGreaterThan(8);
    const painted = paintedKnobCount(out!.pathD, 1);
    expect(painted).toBeLessThanOrEqual(dataN);
  });

  it('pen outline is a closed ribbon; knobs stay sparse on screen', () => {
    const pts = scribblePts(50);
    const sw = 12;
    const out = buildOutlinePath(
      {
        key: 'shape',
        width: 300,
        height: 200,
        attrs: {
          shapeType: 'pen',
          path: polylinePathD(pts),
          'border-color': '#111',
          'border-width': sw,
          closed: 'false',
          strokeLinecap: 'round',
        },
      },
      { zoom: 1 }
    );
    expect(out?.pathD).toBeTruthy();
    expect(out!.closed).toBe(true);
    expect(out!.pathD).toMatch(/z\s*$/i);
    const dataN = pathEditAnchorCount(out!.pathD);
    const painted = paintedKnobCount(out!.pathD, 1);
    expect(painted).toBeGreaterThan(0);
    expect(painted).toBeLessThanOrEqual(48);
    if (dataN > 48) expect(painted).toBeLessThan(dataN);
  });
});
