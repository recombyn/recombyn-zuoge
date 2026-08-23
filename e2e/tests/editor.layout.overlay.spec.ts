/**
 * Editor shell: side panels overlay the canvas — opening them must not shrink the stage.
 */
import { test, expect } from '@playwright/test';
import { E2E_TOKEN_SKIP_REASON } from './e2eAuth';
import {
  TOKEN,
  injectAuth,
  openBlankEditor,
  sleep,
} from '../helpers/canvasEditor';

test.setTimeout(2 * 60_000);

test.describe('editor overlay layout', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
  });

  test('layers panel does not squeeze canvas stage width', async ({ page }) => {
    const stage = await openBlankEditor(page);
    const baseWidth = await stage.evaluate((el) => el.clientWidth);
    expect(baseWidth).toBeGreaterThan(200);

    const layersBtn = page.getByRole('button', { name: /^Layers$|^图层$/i }).first();
    await layersBtn.click({ force: true });
    await sleep(300);

    const withLayers = await stage.evaluate((el) => el.clientWidth);
    expect(Math.abs(withLayers - baseWidth)).toBeLessThan(2);

    await layersBtn.click({ force: true });
    await sleep(200);
    const restored = await stage.evaluate((el) => el.clientWidth);
    expect(Math.abs(restored - baseWidth)).toBeLessThan(2);
  });

  test('image selection toolbar stays inside stage after zoom', async ({ page }) => {
    const stage = await openBlankEditor(page);
    const box = await stage.boundingBox();
    if (!box) throw new Error('no stage box');

    await page.keyboard.press('r');
    await sleep(120);
    const x0 = box.x + box.width * 0.3;
    const y0 = box.y + box.height * 0.3;
    const x1 = box.x + box.width * 0.7;
    const y1 = box.y + box.height * 0.7;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 12 });
    await page.mouse.up();
    await sleep(400);

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    for (let i = 0; i < 24; i += 1) {
      await page.evaluate(
        ({ x, y }) => {
          const el = document.querySelector('[data-rcb-canvas="1"]');
          el?.dispatchEvent(
            new WheelEvent('wheel', {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
              deltaY: -140,
              ctrlKey: true,
            })
          );
        },
        { x: cx, y: cy }
      );
    }
    await sleep(400);

    const inset = await page.evaluate(() => {
      const stageEl = document.querySelector('[data-rcb-canvas="1"]') as HTMLElement | null;
      const toolbar = document.querySelector('[data-sel-toolbar] .pointer-events-auto') as HTMLElement | null;
      if (!stageEl || !toolbar) return null;
      const stageR = stageEl.getBoundingClientRect();
      const pillR = toolbar.getBoundingClientRect();
      return {
        leftInset: pillR.left - stageR.left,
        rightInset: stageR.right - pillR.right,
      };
    });

    expect(inset).not.toBeNull();
    expect(inset!.leftInset).toBeGreaterThanOrEqual(14);
    expect(inset!.rightInset).toBeGreaterThanOrEqual(14);
  });
});
