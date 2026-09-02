/**
 * Regression: shapes drawn inside frames stay visible; animation workbench plate
 * drag stays responsive (no tab freeze).
 */
import { expect, test, type Page } from '@playwright/test';
import { E2E_TOKEN_SKIP_REASON } from './e2eAuth';
import { openBlankEditor as openEditorStage } from '../helpers/canvasEditor';
import {
  dragDraw,
  expectShapeInk,
  focusStage,
  injectAuth,
  openLayers,
  sleep,
  TOKEN,
} from './canvasStressHelpers';

async function spawnAnimationWorkbench(page: Page) {
  await page.keyboard.press('Escape');
  await sleep(150);

  const animBtn = page
    .getByRole('button', { name: /Animation\s*\(M\)|动画\s*\(M\)|動畫\s*\(M\)/i })
    .first();
  await expect(animBtn).toBeVisible({ timeout: 15_000 });
  await expect(animBtn).toBeEnabled();
  await animBtn.click({ force: true });
  await sleep(500);

  await expect(page.locator('[data-rcb-frame-plate="1"]').first()).toBeVisible({
    timeout: 20_000,
  });
}

async function startFrameTimeMonitor(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __e2eFrameTimes?: number[];
      __e2eFrameMonitor?: number;
    };
    w.__e2eFrameTimes = [];
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      if (dt > 0 && dt < 2000) w.__e2eFrameTimes!.push(dt);
      w.__e2eFrameMonitor = requestAnimationFrame(tick);
    };
    w.__e2eFrameMonitor = requestAnimationFrame(tick);
  });
}

async function stopFrameTimeMonitor(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __e2eFrameTimes?: number[];
      __e2eFrameMonitor?: number;
    };
    if (w.__e2eFrameMonitor) cancelAnimationFrame(w.__e2eFrameMonitor);
    w.__e2eFrameMonitor = undefined;
    return w.__e2eFrameTimes || [];
  });
}

function p95(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] || 0;
}

test.describe('canvas frame + workbench regression', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);
  test.setTimeout(4 * 60_000);

  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
  });

  async function openBlankEditor(page: import('@playwright/test').Page) {
    const stage = await openEditorStage(page);
    await expect(
      page.getByRole('button', { name: /Smart frame|智能画板/i }).first()
    ).toBeVisible({ timeout: 15_000 });
    return stage;
  }

  test('rect drawn inside frame stays on scene canvas', async ({ page }) => {
    const stage = await openBlankEditor(page);
    const box = await focusStage(page, stage, 0.35);
    await openLayers(page);

    // Smart frame
    await page.keyboard.press('f');
    await sleep(150);
    const frameFx0 = 0.28;
    const frameFy0 = 0.28;
    const frameFx1 = 0.62;
    const frameFy1 = 0.68;
    await dragDraw(page, box, frameFx0, frameFy0, frameFx1, frameFy1, 14);
    await expect(page.locator('[data-rcb-frame-plate="1"]').first()).toBeVisible({
      timeout: 12_000,
    });
    await sleep(400);

    // Rectangle fully inside the frame
    await page.keyboard.press('r');
    await sleep(150);
    const shapeFx0 = 0.38;
    const shapeFy0 = 0.38;
    const shapeFx1 = 0.52;
    const shapeFy1 = 0.52;
    await dragDraw(page, box, shapeFx0, shapeFy0, shapeFx1, shapeFy1, 12);
    await expect(page.getByText(/^矩形$|^Rectangle$/i).first()).toBeAttached({
      timeout: 12_000,
    });
    await expectShapeInk(page, 1);
    await expect(page.getByRole('textbox', { name: 'W' })).not.toHaveValue('0');

    // Pan the canvas — shape must survive (regression for in-frame ink vanishing).
    await page.keyboard.press('v');
    await sleep(100);
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35, { steps: 10 });
    await page.mouse.up();
    await sleep(400);

    await expect(page.getByText(/^矩形$|^Rectangle$/i).first()).toBeAttached();
    await expectShapeInk(page, 1);
  });

  test('smart frame plate drag stays responsive', async ({ page }) => {
    test.setTimeout(90_000);
    const stage = await openBlankEditor(page);
    const box = await focusStage(page, stage, 0.35);
    await openLayers(page);

    await page.keyboard.press('f');
    await sleep(150);
    await dragDraw(page, box, 0.28, 0.28, 0.55, 0.55, 12);
    await expect(page.locator('[data-rcb-frame-plate="1"]').first()).toBeVisible({
      timeout: 12_000,
    });

    const frameLabel = page.locator('[data-frame-label]').first();
    await expect(frameLabel).toBeVisible({ timeout: 10_000 });
    const labelBox = await frameLabel.boundingBox();
    if (!labelBox) throw new Error('frame label missing box');

    await startFrameTimeMonitor(page);
    await page.mouse.move(labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) {
      await page.mouse.move(
        labelBox.x + labelBox.width / 2 + step * 8,
        labelBox.y + labelBox.height / 2 + step * 5,
        { steps: 1, timeout: 5_000 }
      );
      await sleep(8);
    }
    await page.mouse.up({ timeout: 5_000 });
    await sleep(200);

    const frameTimes = await stopFrameTimeMonitor(page);
    expect(frameTimes.length).toBeGreaterThan(5);
    const median = frameTimes.sort((a, b) => a - b)[Math.floor(frameTimes.length / 2)] || 0;
    const p95Ms = p95(frameTimes);
    console.log('[e2e:frame-drag]', JSON.stringify({ median, p95Ms, samples: frameTimes.length }));
    expect(p95Ms).toBeLessThan(500);
    expect(median).toBeLessThan(120);
  });

  test('animation workbench spawns and timeline opens', async ({ page }) => {
    test.setTimeout(60_000);
    const stage = await openBlankEditor(page);
    await focusStage(page, stage, 0.35);
    await spawnAnimationWorkbench(page);

    await expect(page.locator('[data-frame-label]').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-rcb-frame-plate="1"]').first()).toBeVisible();

    const kfBtn = page.getByRole('button', { name: /^Keyframes$|^关键帧$|^關鍵幀$/i }).first();
    await expect(kfBtn).toBeVisible({ timeout: 10_000 });
    await kfBtn.click({ force: true });
    await expect(page.locator('[data-lottie-timeline-dock]').first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('animation workbench plate drag stays responsive', async ({ page }) => {
    test.setTimeout(90_000);
    const stage = await openBlankEditor(page);
    const box = await focusStage(page, stage, 0.35);
    await spawnAnimationWorkbench(page);

    const frameLabel = page.locator('[data-frame-label]').first();
    await expect(frameLabel).toBeVisible({ timeout: 10_000 });
    const labelBox = await frameLabel.boundingBox();
    if (!labelBox) throw new Error('animation frame label missing box');

    await startFrameTimeMonitor(page);
    const x0 = labelBox.x + labelBox.width / 2;
    const y0 = labelBox.y + labelBox.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) {
      await page.mouse.move(x0 + step * 8, y0 + step * 5, { steps: 1, timeout: 5_000 });
      await sleep(8);
    }
    await page.mouse.up({ timeout: 5_000 });
    await sleep(200);
    const frames = await stopFrameTimeMonitor(page);
    const samples = frames.filter((dt) => dt > 0 && dt < 500);
    const median =
      samples.length === 0
        ? 0
        : [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)] || 0;
    const p95Ms = p95(samples);
    console.log('[e2e:anim-drag]', JSON.stringify({ median, p95Ms, samples: samples.length }));
    expect(samples.length).toBeGreaterThan(5);
    // Empty workbench plate drag must stay interactive (host FO re-seat / videoLiveGeom).
    expect(p95Ms).toBeLessThan(120);
    expect(median).toBeLessThan(50);
    expect(box.width).toBeGreaterThan(0);
  });

  test('light stroked shapes: full-host≈0 and pan stays interactive', async ({ page }) => {
    test.setTimeout(120_000);
    const stage = await openBlankEditor(page);
    const box = await focusStage(page, stage, 0.3);
    await openLayers(page);

    await page.keyboard.press('r');
    await sleep(120);
    // Seed a grid of light rects via the product draw tool (≈16 ink hosts).
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        const fx0 = 0.22 + col * 0.08;
        const fy0 = 0.22 + row * 0.08;
        await dragDraw(page, box, fx0, fy0, fx0 + 0.05, fy0 + 0.05, 6);
        await sleep(40);
      }
    }
    await sleep(500);

    const counts = await page.evaluate(() => {
      const layer = document.querySelector('[data-rcb-shapes-layer="1"]');
      return {
        fullHost: Number(layer?.getAttribute('data-rcb-full-host-count') || '-1'),
        canvasIdle: Number(layer?.getAttribute('data-rcb-canvas-idle-count') || '-1'),
      };
    });
    console.log('[e2e:light-host]', JSON.stringify(counts));
    expect(counts.fullHost).toBe(0);
    expect(counts.canvasIdle).toBeGreaterThan(0);

    await page.keyboard.press('v');
    await sleep(80);
    await startFrameTimeMonitor(page);
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.15);
    await page.mouse.down();
    for (let step = 1; step <= 16; step += 1) {
      await page.mouse.move(
        box.x + box.width * 0.15 + step * 10,
        box.y + box.height * 0.15 + step * 6,
        { steps: 1, timeout: 5_000 }
      );
      await sleep(6);
    }
    await page.mouse.up({ timeout: 5_000 });
    await sleep(150);
    const frames = await stopFrameTimeMonitor(page);
    const samples = frames.filter((dt) => dt > 0 && dt < 500);
    const p95Ms = p95(samples);
    console.log('[e2e:pan-light]', JSON.stringify({ p95Ms, samples: samples.length }));
    expect(samples.length).toBeGreaterThan(5);
    expect(p95Ms).toBeLessThan(120);
  });
});
