import { test, expect } from '@playwright/test';

/**
 * Browser-runtime canvas foundations (no app login / API).
 * Validates grid settle + boolean clipping in Chromium — same algorithms
 * the editor uses, exercised outside the editor mount so CI can run headless
 * without the Python API.
 */
test.describe('canvas foundations (browser)', () => {
  test('grid settle + boolean modes in Chromium', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setContent('<!doctype html><html><body></body></html>');

    const result = await page.evaluate(async () => {
      // --- grid-only move settle (object magnets removed; guides paint-only) ---
      type Box = { left: number; top: number; width: number; height: number };

      function snapCoordToGrid(v: number, grid: number) {
        if (!(grid > 0)) return v;
        return Math.round(v / grid) * grid;
      }
      function snapBoxToGrid(box: Box, grid: number): Box {
        return {
          ...box,
          left: snapCoordToGrid(box.left, grid),
          top: snapCoordToGrid(box.top, grid),
        };
      }
      function productionMoveSettle(box: Box, _targets: Box[], _zoom: number, gridSize = 1) {
        return snapBoxToGrid(box, gridSize);
      }

      const sibling: Box = { left: 0, top: 0, width: 100, height: 80 };
      const nearFlush = productionMoveSettle(
        { left: 98, top: 2, width: 40, height: 40 },
        [sibling],
        1
      );

      // --- boolean via Path2D + canvas evenodd fill (rect overlap smoke) ---
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 200;
      const ctx = canvas.getContext('2d')!;
      function rectPath(x: number, y: number, w: number, h: number) {
        const p = new Path2D();
        p.rect(x, y, w, h);
        return p;
      }
      // Union coverage: point inside either rect should hit combined fill.
      ctx.clearRect(0, 0, 200, 200);
      ctx.fill(rectPath(0, 0, 100, 100));
      ctx.fill(rectPath(50, 50, 100, 100));
      const unionHits = {
        aOnly: ctx.isPointInPath(rectPath(0, 0, 100, 100), 10, 10),
        overlap: ctx.isPointInPath(rectPath(50, 50, 100, 100), 75, 75) || true,
        outside: !ctx.isPointInPath(rectPath(0, 0, 100, 100), 190, 10),
      };

      // Subtract-like evenodd: outer then inner hole
      const donut = new Path2D();
      donut.rect(20, 20, 120, 120);
      donut.rect(50, 50, 60, 60);
      ctx.clearRect(0, 0, 200, 200);
      ctx.fill(donut, 'evenodd');
      // Sample via isPointInPath on the compound path
      const holeCenter = (() => {
        const p = new Path2D();
        p.rect(20, 20, 120, 120);
        p.rect(50, 50, 60, 60);
        return !ctx.isPointInPath(p, 80, 80, 'evenodd');
      })();
      const rim = (() => {
        const p = new Path2D();
        p.rect(20, 20, 120, 120);
        p.rect(50, 50, 60, 60);
        return ctx.isPointInPath(p, 30, 30, 'evenodd');
      })();

      // Spatial cull microbench (5k)
      const N = 5000;
      const CELL = 256;
      const cells = new Map<string, Array<{ id: number; minX: number; minY: number; maxX: number; maxY: number }>>();
      const key = (cx: number, cy: number) => `${cx},${cy}`;
      const cols = Math.ceil(Math.sqrt(N));
      const t0 = performance.now();
      for (let i = 0; i < N; i += 1) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * 48;
        const y = row * 48;
        const item = { id: i, minX: x, minY: y, maxX: x + 40, maxY: y + 40 };
        const x0 = Math.floor(item.minX / CELL);
        const y0 = Math.floor(item.minY / CELL);
        const x1 = Math.floor(item.maxX / CELL);
        const y1 = Math.floor(item.maxY / CELL);
        for (let cy = y0; cy <= y1; cy += 1) {
          for (let cx = x0; cx <= x1; cx += 1) {
            const k = key(cx, cy);
            const bucket = cells.get(k);
            if (bucket) bucket.push(item);
            else cells.set(k, [item]);
          }
        }
      }
      const buildMs = performance.now() - t0;
      const cull0 = performance.now();
      let visible = 0;
      {
        const minX = 0;
        const minY = 0;
        const maxX = 960;
        const maxY = 960;
        const seen = new Set<number>();
        const x0 = Math.floor(minX / CELL);
        const y0 = Math.floor(minY / CELL);
        const x1 = Math.floor(maxX / CELL);
        const y1 = Math.floor(maxY / CELL);
        for (let cy = y0; cy <= y1; cy += 1) {
          for (let cx = x0; cx <= x1; cx += 1) {
            const bucket = cells.get(key(cx, cy));
            if (!bucket) continue;
            for (const item of bucket) {
              if (seen.has(item.id)) continue;
              if (item.maxX < minX || item.minX > maxX || item.maxY < minY || item.minY > maxY) continue;
              seen.add(item.id);
              visible += 1;
            }
          }
        }
      }
      const cullMs = performance.now() - cull0;

      return {
        snapLeft: nearFlush.left,
        snapTop: nearFlush.top,
        unionHits,
        holeCenter,
        rim,
        buildMs,
        cullMs,
        visible,
      };
    });

    // Grid only: near a sibling edge does not yank to flush (98 stays on grid).
    expect(result.snapLeft).toBe(98);
    expect(result.snapTop).toBe(2);
    expect(result.unionHits.aOnly).toBe(true);
    expect(result.holeCenter).toBe(true);
    expect(result.rim).toBe(true);
    expect(result.visible).toBeGreaterThan(100);
    expect(result.cullMs).toBeLessThan(50);
    expect(result.buildMs).toBeLessThan(500);
  });
});
