import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Browser stress: mount a design-like mixed scene (rects / text / paths / heavy
 * outlines), cull with a grid index, paint LOD full hosts + shared proxy SVG,
 * then measure pan frames — mirrors RcbShapesLayer after the opt pass.
 */
test.describe('canvas stress (browser)', () => {
  test('editor route responds (login redirect ok)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/editor', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 15_000 });
    expect(page.url().length).toBeGreaterThan(0);
  });

  test('mixed 5k scene: index cull + LOD hosts + pan frames', async ({ page }) => {
    await page.setContent('<!doctype html><html><body><div id="stage"></div></body></html>');

    const result = await page.evaluate(async () => {
      const N = 5000;
      const CELL = 256;
      const MAX_FULL = 40; // far-zoom budget
      const HEAVY = 12_000;

      type Item = { id: string; minX: number; minY: number; maxX: number; maxY: number; kind: string; fill: string; d?: string };
      const cells = new Map<string, Item[]>();
      const byId = new Map<string, Item>();
      const key = (cx: number, cy: number) => `${cx},${cy}`;

      const upsert = (item: Item) => {
        byId.set(item.id, item);
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
      };

      const search = (minX: number, minY: number, maxX: number, maxY: number) => {
        const out: Item[] = [];
        const seen = new Set<string>();
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
              out.push(item);
            }
          }
        }
        return out;
      };

      const heavyD = (() => {
        const parts = ['M 0 0'];
        for (let i = 1; i <= 800; i += 1) parts.push(`L ${(i % 40) * 1.1} ${(i % 37) * 0.9}`);
        parts.push('Z');
        let d = parts.join(' ');
        if (d.length < HEAVY) d = `${d} ${d}`;
        return d;
      })();

      const cols = Math.ceil(Math.sqrt(N));
      const tBuild0 = performance.now();
      for (let i = 0; i < N; i += 1) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * 48;
        const y = row * 48;
        const m = i % 20;
        let kind = 'rect';
        let fill = '#EEF2FF';
        let d: string | undefined;
        if (m >= 10 && m < 14) {
          kind = 'text';
          fill = '#111827';
        } else if (m >= 14 && m < 18) {
          kind = 'path';
          fill = '#FEE2E2';
          d = 'M 0 0 L 40 0 L 40 40 Z';
        } else if (m >= 18) {
          kind = 'heavy';
          fill = '#FECACA';
          d = heavyD;
        }
        upsert({
          id: `n${i}`,
          minX: x,
          minY: y,
          maxX: x + (kind === 'text' ? 120 : 40),
          maxY: y + (kind === 'text' ? 28 : 40),
          kind,
          fill,
          d,
        });
      }
      const buildMs = performance.now() - tBuild0;

      const view = { minX: 0, minY: 0, maxX: 960, maxY: 960 };
      const cullSamples: number[] = [];
      let visible: Item[] = [];
      for (let i = 0; i < 20; i += 1) {
        const t0 = performance.now();
        visible = search(view.minX, view.minY, view.maxX, view.maxY);
        cullSamples.push(performance.now() - t0);
      }
      cullSamples.sort((a, b) => a - b);
      const cullMs = cullSamples[Math.floor(cullSamples.length / 2)];

      // LOD: keep largest screen-area (approx AABB area) as full hosts.
      const scored = [...visible].sort(
        (a, b) =>
          (b.maxX - b.minX) * (b.maxY - b.minY) - (a.maxX - a.minX) * (a.maxY - a.minY)
      );
      const full = scored.slice(0, Math.min(MAX_FULL, scored.length));
      const proxy = scored.slice(full.length);

      const stage = document.getElementById('stage')!;
      stage.style.cssText =
        'position:relative;width:960px;height:640px;overflow:hidden;background:#f8fafc';
      const world = document.createElement('div');
      world.style.cssText = 'position:absolute;left:0;top:0;will-change:transform';
      stage.appendChild(world);

      const tMount0 = performance.now();
      const lodSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      lodSvg.setAttribute('width', '1');
      lodSvg.setAttribute('height', '1');
      lodSvg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible';
      for (const item of proxy) {
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', String(item.minX));
        r.setAttribute('y', String(item.minY));
        r.setAttribute('width', String(item.maxX - item.minX));
        r.setAttribute('height', String(item.maxY - item.minY));
        r.setAttribute('fill', item.fill);
        r.setAttribute('opacity', '0.85');
        lodSvg.appendChild(r);
      }
      world.appendChild(lodSvg);

      for (const item of full) {
        const host = document.createElement('div');
        host.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '1');
        svg.setAttribute('height', '1');
        svg.style.overflow = 'visible';
        if (item.kind === 'path' || item.kind === 'heavy') {
          const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          p.setAttribute('d', item.d || 'M0 0h40v40z');
          p.setAttribute('fill', item.fill);
          p.setAttribute('transform', `translate(${item.minX} ${item.minY})`);
          svg.appendChild(p);
        } else if (item.kind === 'text') {
          const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          t.setAttribute('x', String(item.minX + 4));
          t.setAttribute('y', String(item.minY + 18));
          t.setAttribute('fill', item.fill);
          t.setAttribute('font-size', '14');
          t.textContent = item.id;
          svg.appendChild(t);
        } else {
          const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          r.setAttribute('x', String(item.minX));
          r.setAttribute('y', String(item.minY));
          r.setAttribute('width', String(item.maxX - item.minX));
          r.setAttribute('height', String(item.maxY - item.minY));
          r.setAttribute('fill', item.fill);
          r.setAttribute('stroke', '#334155');
          svg.appendChild(r);
        }
        host.appendChild(svg);
        world.appendChild(host);
      }
      const mountMs = performance.now() - tMount0;

      // Simulate camera pan for 45 frames.
      const frameMs: number[] = [];
      await new Promise<void>((resolve) => {
        let i = 0;
        let last = performance.now();
        const tick = (now: number) => {
          frameMs.push(now - last);
          last = now;
          world.style.transform = `translate(${-i * 12}px, ${-i * 6}px) scale(0.28)`;
          i += 1;
          if (i < 45) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      frameMs.sort((a, b) => a - b);
      const panMedianMs = frameMs[Math.floor(frameMs.length / 2)] || 0;
      const panP95Ms = frameMs[Math.floor(frameMs.length * 0.95)] || 0;

      return {
        N,
        buildMs,
        cullMs,
        visible: visible.length,
        fullHosts: full.length,
        proxyHosts: proxy.length,
        mountMs,
        panMedianMs,
        panP95Ms,
        heavyChars: heavyD.length,
      };
    });

    expect(result.N).toBe(5000);
    expect(result.visible).toBeGreaterThan(100);
    expect(result.fullHosts).toBeLessThanOrEqual(40);
    expect(result.proxyHosts).toBeGreaterThan(0);
    expect(result.buildMs).toBeLessThan(3_000);
    expect(result.cullMs).toBeLessThan(50);
    expect(result.mountMs).toBeLessThan(2_000);
    // Soft: median frame under ~50ms on CI; local machines usually much faster.
    expect(result.panMedianMs).toBeLessThan(80);

    const out = {
      when: new Date().toISOString(),
      env: 'playwright-chromium',
      result,
    };
    writeFileSync(
      resolve(__dirname, 'canvas.stress.browser.results.json'),
      JSON.stringify(out, null, 2),
      'utf8'
    );
    // eslint-disable-next-line no-console
    console.log('BROWSER_STRESS', JSON.stringify(out, null, 2));
  });
});
