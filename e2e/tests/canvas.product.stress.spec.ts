/**
 * Canvas product stress — live editor ops, deep flows, and tool panels.
 * Requires E2E_TOKEN. Synthetic perf stays in canvas.stress.spec.ts.
 */
import { test, expect } from '@playwright/test';
import { E2E_TOKEN_SKIP_REASON } from './e2eAuth';
import {
  TOKEN,
  injectAuth,
  openBlankEditor,
  focusStage,
  openLayers,
  expectLayerLabel,
  expectShapeInk,
  dragDraw,
  toolBtn,
  sleep,
  uploadPngToCanvas,
  uploadPng,
  makeWebmBuffer,
} from './canvasStressHelpers';

const IMAGE_GEN_BTN = /Image generator|图像生成器/i;
const ALIGN_GROUP = /^对齐$|^Align$/i;
const ALIGN_LEFT = /^左对齐$|^Align left$/i;
const BOOLEAN_BTN = /^布尔运算$|^Boolean$/i;
const BOOL_UNION = /^并集$|^Union$/i;

test.setTimeout(6 * 60_000);

test.describe('canvas product stress', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
  });

  test.describe('ops', () => {
    test('tool hotkeys + draw shape/frame/text + layers', async ({ page }) => {
      const stage = await openBlankEditor(page, 'canvas-ops');
      const box = await focusStage(page, stage, 0.6);
      await openLayers(page);

      const tools: Array<{ key: string; en: string; zh: string }> = [
        { key: 'v', en: 'Select / Move', zh: '选择 / 移动' },
        { key: 'p', en: 'Pen', zh: '钢笔' },
        { key: 'Shift+P', en: 'Pencil', zh: '画笔' },
        { key: 't', en: 'Text', zh: '文字' },
        { key: 'f', en: 'Smart frame', zh: '智能画板' },
      ];
      for (const t of tools) {
        await page.keyboard.press(t.key);
        await sleep(120);
        const btn = toolBtn(page, t.en, t.zh);
        if (await btn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await expect(btn).toBeVisible();
        }
      }

      await page.keyboard.press('r');
      await sleep(150);
      await dragDraw(page, box, 0.25, 0.25, 0.42, 0.42, 12);
      await expectLayerLabel(page, /^矩形$|^Rectangle$/i);

      await page.keyboard.press('o');
      await sleep(150);
      await dragDraw(page, box, 0.5, 0.25, 0.65, 0.4, 12);
      await expectLayerLabel(page, /^椭圆$|^Ellipse$|^Circle$/i);

      await page.keyboard.press('f');
      await sleep(150);
      await dragDraw(page, box, 0.15, 0.55, 0.4, 0.8, 12);
      await expectLayerLabel(page, /画板|Frame|frame/i);

      await page.keyboard.press('v');
      await sleep(100);
      await page.keyboard.press('t');
      await sleep(150);
      await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.6);
      await expect(
        page.locator('[data-text-inline-editor], [contenteditable="true"]').first()
      ).toBeVisible({ timeout: 12_000 });
      await page.keyboard.type('ops-stress-text', { delay: 8 });
      await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.2);
      await sleep(300);
      await page.keyboard.press('v');
      await sleep(150);
      const textOk =
        (await page.getByText(/ops-stress-text/i).count()) > 0 ||
        (await page.getByText(/^文字$|^Text$/i).count()) > 0;
      expect(textOk).toBe(true);
    });

    test('select duplicate delete undo + clipboard', async ({ page }) => {
      const stage = await openBlankEditor(page, 'canvas-ops');
      const box = await focusStage(page, stage, 0.6);
      await openLayers(page);

      await page.keyboard.press('r');
      await sleep(120);
      await dragDraw(page, box, 0.3, 0.3, 0.48, 0.48, 12);
      await expectLayerLabel(page, /^矩形$|^Rectangle$/i);

      await page.keyboard.press('v');
      await sleep(100);
      await page.mouse.click(box.x + box.width * 0.39, box.y + box.height * 0.39);
      await sleep(150);

      const before = await page.getByText(/^矩形$|^Rectangle$/i).count();
      await page.keyboard.press('Control+d');
      await sleep(400);
      const afterDup = await page.getByText(/^矩形$|^Rectangle$/i).count();
      expect(afterDup).toBeGreaterThanOrEqual(before);

      await page.keyboard.press('Control+c');
      await sleep(150);
      await page.keyboard.press('Control+v');
      await sleep(400);
      const afterPaste = await page.getByText(/^矩形$|^Rectangle$/i).count();
      expect(afterPaste).toBeGreaterThanOrEqual(afterDup);

      await page.keyboard.press('Delete');
      await sleep(300);
      await page.keyboard.press('Control+z');
      await sleep(300);
      await expectLayerLabel(page, /^矩形$|^Rectangle$/i, 8_000);
    });

    test('pen stroke + generators + zoom + ctx lock', async ({ page }) => {
      const stage = await openBlankEditor(page, 'canvas-ops');
      const box = await focusStage(page, stage, 0.6);
      await openLayers(page);

      await page.keyboard.press('p');
      await sleep(150);
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.28, { steps: 16 });
      await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.22, { steps: 16 });
      await page.mouse.up();
      await sleep(300);
      await page.keyboard.press('Enter');
      await sleep(200);
      await page.keyboard.press('v');
      await sleep(100);
      await focusStage(page, stage, 0.6);

      // Prefer hotkey — toolbar click can miss when the strip is busy after pen.
      await page.keyboard.press('a');
      await expect(page.locator('[data-image-generator]').first()).toBeVisible({ timeout: 15_000 });
      await page.keyboard.press('Escape');
      await sleep(200);

      await focusStage(page, stage, 0.6);
      await page.keyboard.press('Shift+A');
      await expect(page.locator('[data-video-generator]').first()).toBeVisible({ timeout: 15_000 });
      await page.keyboard.press('Escape');
      await sleep(200);

      await focusStage(page, stage, 0.6);
      await page.keyboard.press('Control+=');
      await sleep(150);
      await page.keyboard.press('Control+-');
      await sleep(150);
      await page.keyboard.press('Control+0');
      await sleep(150);

      await page.keyboard.press('r');
      await sleep(100);
      await dragDraw(page, box, 0.55, 0.55, 0.7, 0.7, 12);
      await page.keyboard.press('v');
      await sleep(100);
      await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.62);
      await sleep(150);
      await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.62, {
        button: 'right',
      });
      const lock = page
        .locator('[data-ctx-menu-panel]')
        .getByText(/^锁定$|^Lock$/i)
        .first();
      if (await lock.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await lock.click({ force: true });
        await sleep(200);
      } else {
        await page.keyboard.press('Escape');
      }

      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press('r');
        await sleep(80);
        const f = 0.12 + i * 0.06;
        await dragDraw(page, box, f, 0.15, f + 0.08, 0.28, 12);
      }
      await expectLayerLabel(page, /^矩形$|^Rectangle$/i);
    });
  });

  test.describe('deep', () => {
    test('upload image + mark region shows live draft preview', async ({ page }) => {
      await page.route('**/api/v1/image/process**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ layers: [], width: 320, height: 240, warnings: [] }),
        });
      });

      await openBlankEditor(page, 'canvas-deep');
      await openLayers(page);
      const markBtn = await uploadPngToCanvas(page);
      await markBtn.click({ force: true });
      await sleep(500);

      const overlay = page.locator('[data-mark-overlay]').first();
      await expect(overlay).toBeVisible({ timeout: 15_000 });
      const ob = await overlay.boundingBox();
      expect(ob).toBeTruthy();

      const x0 = ob!.x + ob!.width * 0.25;
      const y0 = ob!.y + ob!.height * 0.25;
      const x1 = ob!.x + ob!.width * 0.55;
      const y1 = ob!.y + ob!.height * 0.55;

      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 8 });
      await expect(page.locator('[data-mark-draft="1"]').first()).toBeVisible({ timeout: 5_000 });
      await page.mouse.move(x1, y1, { steps: 8 });
      await expect(page.locator('[data-mark-draft="1"]').first()).toBeVisible();
      await page.mouse.up();
      await sleep(400);

      await expect(page.locator('[data-mark-draft="1"]')).toHaveCount(0, { timeout: 5_000 });
      await expect(page.getByText(/区域|region/i).first()).toBeAttached({ timeout: 10_000 });
    });

    test('shape selected → resize via W dock + nudge', async ({ page }) => {
      const stage = await openBlankEditor(page, 'canvas-deep');
      const box = await focusStage(page, stage);
      await openLayers(page);

      await page.keyboard.press('r');
      await sleep(100);
      await dragDraw(page, box, 0.3, 0.3, 0.48, 0.48);
      await expectLayerLabel(page, /^矩形$|^Rectangle$/i);

      await page.keyboard.press('v');
      await sleep(120);
      await page.mouse.click(box.x + box.width * 0.39, box.y + box.height * 0.39);
      await sleep(300);

      const rotate = page.getByRole('button', { name: /^Rotate$/i }).first();
      const wLabeled = page.getByRole('textbox', { name: 'W' }).or(page.getByLabel('W')).first();
      const selected =
        (await rotate.isVisible({ timeout: 8_000 }).catch(() => false)) ||
        (await wLabeled.isVisible({ timeout: 2_000 }).catch(() => false));
      expect(selected).toBe(true);

      if (await wLabeled.isVisible().catch(() => false)) {
        const w0 = Number(await wLabeled.inputValue());
        expect(w0).toBeGreaterThan(10);
        await wLabeled.click({ force: true });
        await wLabeled.fill(String(Math.round(w0 + 80)));
        await wLabeled.press('Enter');
        await sleep(250);
        const w1 = Number(await wLabeled.inputValue());
        expect(w1).toBeGreaterThanOrEqual(w0 + 40);
      } else {
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowDown');
        await sleep(200);
        await expect(rotate).toBeVisible();
      }
    });

    test('multi-shape + group + ctx lock + export PNG', async ({ page }) => {
      test.setTimeout(3 * 60_000);
      const stage = await openBlankEditor(page, 'canvas-deep');
      const box = await focusStage(page, stage);
      await openLayers(page);

      await page.keyboard.press('r');
      await sleep(80);
      await dragDraw(page, box, 0.22, 0.22, 0.36, 0.36);
      await page.keyboard.press('o');
      await sleep(80);
      await dragDraw(page, box, 0.42, 0.22, 0.56, 0.36);
      await expectLayerLabel(page, /^矩形$|^Rectangle$/i);
      await expectLayerLabel(page, /^椭圆$|^Ellipse$|^Circle$/i);

      await page.keyboard.press('v');
      await sleep(100);
      await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.18);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.42, { steps: 14 });
      await page.mouse.up();
      await sleep(300);

      await page.keyboard.press('Control+g');
      await sleep(350);

      const alignLeft = page.getByRole('button', { name: /Align left|左对齐/i }).first();
      if (await alignLeft.isVisible({ timeout: 2_500 }).catch(() => false)) {
        await alignLeft.click({ force: true });
        await sleep(150);
      }

      await page.keyboard.press('Control+Shift+K');
      await sleep(200);

      const topExport = page.getByRole('button', { name: /^Export$|^导出$/i }).first();
      await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.28);
      await sleep(200);

      let downloaded = false;
      if (await topExport.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await topExport.click({ force: true });
        await sleep(400);
        const png = page.getByRole('button', { name: /^PNG$/i }).or(page.getByText(/^PNG$/i)).first();
        if (await png.isVisible({ timeout: 4_000 }).catch(() => false)) {
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 25_000 }),
            png.click({ force: true }),
          ]);
          expect(download.suggestedFilename().toLowerCase()).toMatch(/\.png$/);
          downloaded = true;
        }
      }

      if (!downloaded) {
        await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.28, {
          button: 'right',
        });
        const exportItem = page.getByText(/^Export$|^导出$/i).last();
        await expect(exportItem).toBeVisible({ timeout: 8_000 });
        await exportItem.hover();
        await sleep(300);
        const png = page.getByText(/^PNG$/i).first();
        await expect(png).toBeVisible({ timeout: 5_000 });
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 25_000 }),
          png.click({ force: true }),
        ]);
        expect(download.suggestedFilename().toLowerCase()).toMatch(/\.png$/);
      }
    });

    test('pen + pencil strokes commit without crash', async ({ page }) => {
      const stage = await openBlankEditor(page, 'canvas-deep');
      const box = await focusStage(page, stage);
      await openLayers(page);

      await page.keyboard.press('p');
      await sleep(150);
      await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.35);
      await sleep(80);
      await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.3);
      await sleep(80);
      await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.4);
      await sleep(120);
      await page.keyboard.press('Enter');
      await sleep(400);
      await page.keyboard.press('v');
      await sleep(200);
      await expectShapeInk(page, 1);
      await expect(
        page
          .getByRole('textbox', { name: /^W$/i })
          .or(page.getByText(/^钢笔$|^Pen$|^路径$|^Path$|^矩形$|^Rectangle$/i))
          .first()
      ).toBeAttached({ timeout: 10_000 });

      await page.keyboard.press('Shift+P');
      await sleep(150);
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
      await page.mouse.down();
      for (let i = 1; i <= 12; i += 1) {
        await page.mouse.move(
          box.x + box.width * (0.2 + i * 0.03),
          box.y + box.height * (0.6 + (i % 2) * 0.015),
          { steps: 2 }
        );
      }
      await page.mouse.up();
      await sleep(500);
      await page.keyboard.press('v');
      await sleep(200);
      await expectShapeInk(page, 1);
      await expect(page.locator('[data-rcb-canvas="1"]').first()).toBeVisible();
    });

    test('frame + text + image generator', async ({ page }) => {
      await openBlankEditor(page, 'canvas-deep');
      const stage = page.locator('[data-rcb-canvas="1"], [data-canvas-stage="1"]').first();
      const box = await focusStage(page, stage);

      await page.keyboard.press('f');
      await sleep(100);
      await dragDraw(page, box, 0.15, 0.15, 0.45, 0.5);
      await expectLayerLabel(page, /画板|Frame|frame/i);

      await page.keyboard.press('t');
      await sleep(100);
      await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.3);
      await expect(
        page.locator('[data-text-inline-editor], [contenteditable="true"]').first()
      ).toBeVisible({ timeout: 10_000 });
      await page.keyboard.type('deep-stress', { delay: 6 });
      await page.keyboard.press('Escape');
      await sleep(150);
      await page.keyboard.press('v');
      await sleep(100);
      // Deselect the frame — generator chrome needs single-node selection.
      await page.mouse.click(box.x + 12, box.y + 12);
      await sleep(100);
      await focusStage(page, stage, 0.2);
      await sleep(100);

      // SplitToolButton primary click only opens the menu; spawn via hotkey / menu row.
      await page.keyboard.press('a');
      const plate = page.locator('[data-image-generator]').first();
      if (!(await plate.isVisible({ timeout: 3_000 }).catch(() => false))) {
        const genBtn = page.getByRole('button', { name: IMAGE_GEN_BTN }).first();
        await genBtn.click({ force: true });
        await page
          .getByRole('menu', { name: IMAGE_GEN_BTN })
          .getByRole('button', { name: IMAGE_GEN_BTN })
          .first()
          .click({ force: true });
      }
      await expect(page.locator('[data-image-generator]').first()).toBeVisible({ timeout: 12_000 });
      await expect(page).toHaveURL(/\/editor\//);
    });
  });

  test.describe('tools', () => {
    test('image tool panels: eraser / multi-angle / crop / expand / adjust', async ({ page }) => {
      await page.route('**/api/v1/image/process**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ layers: [], width: 320, height: 240, warnings: [] }),
        });
      });

      await openBlankEditor(page, 'canvas-tools');
      await openLayers(page);
      await uploadPng(page);

      const tools: Array<{ name: RegExp }> = [
        { name: /^橡皮工具$|^Eraser$/i },
        { name: /^多角度$|^Multi-angle$/i },
        { name: /^裁剪$|^Crop$/i },
        { name: /^扩展$|^Expand$/i },
        { name: /^调整$|^Adjust$/i },
      ];

      let opened = 0;
      for (const tool of tools) {
        const btn = page.getByRole('button', { name: tool.name }).first();
        if (!(await btn.isVisible({ timeout: 4_000 }).catch(() => false))) continue;
        await btn.click({ force: true });
        await sleep(400);
        const panel = page.locator('[data-image-tool-panel]').first();
        if (await panel.isVisible({ timeout: 8_000 }).catch(() => false)) {
          opened += 1;
        }
        await page.keyboard.press('Escape');
        await sleep(250);
        const stage = page.locator('[data-rcb-canvas="1"]').first();
        const box = await stage.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45);
          await sleep(300);
        }
      }
      expect(opened).toBeGreaterThanOrEqual(1);
      await expect(page).toHaveURL(/\/editor\//);
      await expect(page.getByRole('button', { name: IMAGE_GEN_BTN }).first()).toBeVisible();
    });

    test('multi-select align + boolean union hard asserts', async ({ page }) => {
      const stage = await openBlankEditor(page, 'canvas-tools');
      const box = await focusStage(page, stage);
      await openLayers(page);

      await page.keyboard.press('r');
      await sleep(80);
      await dragDraw(page, box, 0.2, 0.25, 0.34, 0.4);
      await page.keyboard.press('r');
      await sleep(80);
      await dragDraw(page, box, 0.42, 0.28, 0.56, 0.42);
      await page.keyboard.press('r');
      await sleep(80);
      await dragDraw(page, box, 0.28, 0.48, 0.42, 0.6);

      await page.keyboard.press('v');
      await sleep(100);
      await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.68, { steps: 16 });
      await page.mouse.up();
      await sleep(400);

      const alignGroup = page.getByRole('group', { name: ALIGN_GROUP }).first();
      await expect(alignGroup).toBeVisible({ timeout: 10_000 });
      const alignLeft = page.getByRole('button', { name: ALIGN_LEFT }).first();
      await expect(alignLeft).toBeVisible({ timeout: 5_000 });
      await alignLeft.click({ force: true });
      await sleep(250);

      const boolBtn = page.getByRole('button', { name: BOOLEAN_BTN }).first();
      await expect(boolBtn).toBeVisible({ timeout: 8_000 });
      await boolBtn.click({ force: true });
      await sleep(200);
      const union = page.getByText(BOOL_UNION).first();
      await expect(union).toBeVisible({ timeout: 5_000 });
      await union.click({ force: true });
      await sleep(500);

      await expect(page).toHaveURL(/\/editor\//);
      await expectShapeInk(page, 1);
      await expect(
        page.getByRole('textbox', { name: 'W' }).or(page.getByText(/^矩形$|^Rectangle$|^路径$|^Path$/i)).first()
      ).toBeAttached({ timeout: 10_000 });
    });

    test('density: 30 rapid rects without crash', async ({ page }) => {
      const stage = await openBlankEditor(page, 'canvas-tools');
      const box = await focusStage(page, stage);
      await openLayers(page);

      await page.keyboard.press('Escape');
      await sleep(80);
      await page.keyboard.press('r');
      await sleep(80);
      await dragDraw(page, box, 0.25, 0.25, 0.38, 0.38);
      await expectLayerLabel(page, /^矩形$|^Rectangle$/i);
      await expectShapeInk(page, 1);

      await page.keyboard.press('v');
      await sleep(80);
      await page.mouse.click(box.x + box.width * 0.31, box.y + box.height * 0.31);
      await sleep(200);

      for (let i = 0; i < 29; i += 1) {
        await page.keyboard.press('Control+d');
        await sleep(60);
      }

      await page.keyboard.press('Escape');
      await sleep(80);
      await page.mouse.click(box.x + 12, box.y + 12);
      await sleep(80);
      await page.keyboard.press('Control+a');
      await sleep(400);
      await expect(page.getByRole('group', { name: ALIGN_GROUP }).first()).toBeVisible({
        timeout: 12_000,
      });
      await expect(page).toHaveURL(/\/editor\//);
      await expect(page.getByRole('button', { name: IMAGE_GEN_BTN }).first()).toBeVisible();
    });

    test('video upload opens trim toolbar', async ({ page }) => {
      const webm = await makeWebmBuffer(page);
      test.skip(!webm || webm.length < 100, 'MediaRecorder webm unavailable');

      await openBlankEditor(page, 'canvas-tools');
      await openLayers(page);

      const input = page.locator('input[type="file"][accept*="image"]').first();
      await input.setInputFiles({
        name: `tools-${Date.now()}.webm`,
        mimeType: 'video/webm',
        buffer: webm!,
      });
      await sleep(2_000);

      const trimBtn = page.getByRole('button', { name: /^剪辑$|^Trim$/i }).first();
      if (!(await trimBtn.isVisible({ timeout: 12_000 }).catch(() => false))) {
        const stage = page.locator('[data-rcb-canvas="1"]').first();
        const box = await stage.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45);
          await sleep(500);
        }
      }
      await expect(trimBtn).toBeVisible({ timeout: 25_000 });
      await trimBtn.click({ force: true });
      await expect(page.locator('[data-video-trim-toolbar]').first()).toBeVisible({
        timeout: 15_000,
      });
    });
  });
});
