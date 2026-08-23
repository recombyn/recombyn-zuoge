/**
 * Intelligence-gated image tools — toolbar visibility + panel/process UX.
 * Mocks capabilities by default; set E2E_INTELLIGENCE=1 for live API smoke.
 */
import { test, expect } from '@playwright/test';
import { E2E_TOKEN_SKIP_REASON } from './e2eAuth';
import {
  TOKEN,
  IMAGE_TOOL_LABELS,
  injectAuth,
  openBlankEditor,
  openLayers,
  openQuickEdit,
  uploadPngAndSelect,
  mockIntelligenceCapabilities,
  mockImageProcessOk,
  sleep,
} from '../helpers/canvasEditor';

const LIVE_INTEL = process.env.E2E_INTELLIGENCE === '1';

test.setTimeout(6 * 60_000);

test.describe('intelligence image tools', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
    if (!LIVE_INTEL) {
      await mockIntelligenceCapabilities(page);
      await mockImageProcessOk(page);
    }
  });

  test('ILP toolbar buttons visible after image upload', async ({ page }) => {
    await openBlankEditor(page);
    await openLayers(page);
    await uploadPngAndSelect(page);

    for (const key of ['mark', 'removeBg', 'eraser', 'editText', 'splitLayers'] as const) {
      await expect(
        page.getByRole('button', { name: IMAGE_TOOL_LABELS[key] }).first()
      ).toBeVisible({ timeout: 12_000 });
    }
  });

  test('mark: overlay and region badge from toolbar', async ({ page }) => {
    await openBlankEditor(page);
    await openLayers(page);
    await uploadPngAndSelect(page);

    await page.getByRole('button', { name: IMAGE_TOOL_LABELS.mark }).first().click({ force: true });
    await sleep(400);

    const overlay = page.locator('[data-mark-overlay]').first();
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    const ob = await overlay.boundingBox();
    expect(ob).toBeTruthy();

    const x0 = ob!.x + ob!.width * 0.2;
    const y0 = ob!.y + ob!.height * 0.2;
    const x1 = ob!.x + ob!.width * 0.55;
    const y1 = ob!.y + ob!.height * 0.55;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 10 });
    await page.mouse.up();
    await sleep(800);

    await expect(page.getByText(/\[1\].*区域|region/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/识别主题中/)).toHaveCount(0, { timeout: 3_000 });
  });

  test('mark: quick-edit chip after box draw', async ({ page }) => {
    await openBlankEditor(page);
    await openLayers(page);
    await uploadPngAndSelect(page);
    await openQuickEdit(page);

    const composer = page.locator('[data-image-quick-edit]').first();
    await composer.getByRole('button', { name: IMAGE_TOOL_LABELS.mark }).click({ force: true });
    await sleep(400);

    const overlay = page.locator('[data-mark-overlay]').first();
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    const ob = await overlay.boundingBox();
    expect(ob).toBeTruthy();

    const x0 = ob!.x + ob!.width * 0.2;
    const y0 = ob!.y + ob!.height * 0.2;
    const x1 = ob!.x + ob!.width * 0.55;
    const y1 = ob!.y + ob!.height * 0.55;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 10 });
    await page.mouse.up();
    await sleep(800);

    await expect(composer.getByText(/\[1\].*区域|region/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/识别主题中/)).toHaveCount(0, { timeout: 3_000 });
  });

  test('eraser panel opens and closes', async ({ page }) => {
    await openBlankEditor(page);
    await openLayers(page);
    await uploadPngAndSelect(page);

    await page.getByRole('button', { name: IMAGE_TOOL_LABELS.eraser }).first().click({ force: true });
    await expect(page.locator('[data-image-tool-panel]').first()).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await sleep(300);
  });

  test('removeBg triggers image process without crash', async ({ page }) => {
    let sawRemoveBg = false;
    await page.route('**/api/v1/image/process**', async (route) => {
      const body = route.request().postDataJSON() as { kind?: string };
      if (body?.kind === 'removeBg') sawRemoveBg = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          layers: [
            {
              type: 'image',
              name: 'cutout',
              x: 0,
              y: 0,
              width: 320,
              height: 240,
              image:
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            },
          ],
          width: 320,
          height: 240,
          warnings: [],
        }),
      });
    });
    await page.route('**/api/v1/image/tools**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ilp: { enabled: true }, mockup: { enabled: true } }),
      });
    });

    await openBlankEditor(page);
    await openLayers(page);
    await uploadPngAndSelect(page);
    await page.getByRole('button', { name: IMAGE_TOOL_LABELS.removeBg }).first().click({ force: true });
    await sleep(2_000);
    expect(sawRemoveBg).toBe(true);
    await expect(page).toHaveURL(/\/editor\//);
  });

  test('editText triggers process kind', async ({ page }) => {
    const kinds: string[] = [];
    await page.route('**/api/v1/image/process**', async (route) => {
      const body = route.request().postDataJSON() as { kind?: string };
      if (body?.kind) kinds.push(body.kind);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          layers: [
            {
              type: 'text',
              name: '文字',
              x: 20,
              y: 20,
              width: 100,
              height: 32,
              text: 'Hi',
            },
          ],
          width: 320,
          height: 240,
          warnings: [],
        }),
      });
    });
    await page.route('**/api/v1/image/tools**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ilp: { enabled: true }, mockup: { enabled: true } }),
      });
    });

    await openBlankEditor(page);
    await openLayers(page);
    await uploadPngAndSelect(page);
    await page.getByRole('button', { name: IMAGE_TOOL_LABELS.editText }).first().click({ force: true });
    await expect.poll(() => kinds.includes('editText'), { timeout: 15_000 }).toBe(true);
  });

  test('splitLayers triggers process kind', async ({ page }) => {
    const kinds: string[] = [];
    await page.route('**/api/v1/image/process**', async (route) => {
      const body = route.request().postDataJSON() as { kind?: string };
      if (body?.kind) kinds.push(body.kind);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          layers: [
            {
              type: 'image',
              name: 'layer',
              x: 0,
              y: 0,
              width: 320,
              height: 240,
              image:
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            },
          ],
          width: 320,
          height: 240,
          warnings: [],
        }),
      });
    });
    await page.route('**/api/v1/image/tools**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ilp: { enabled: true }, mockup: { enabled: true } }),
      });
    });

    await openBlankEditor(page);
    await openLayers(page);
    await uploadPngAndSelect(page);
    await page.getByRole('button', { name: IMAGE_TOOL_LABELS.splitLayers }).first().click({ force: true });
    await expect.poll(() => kinds.includes('editElements'), { timeout: 15_000 }).toBe(true);
  });

  test('mockup entry in More menu when enabled', async ({ page }) => {
    await openBlankEditor(page);
    await openLayers(page);
    await uploadPngAndSelect(page);

    const more = page.getByRole('button', { name: IMAGE_TOOL_LABELS.more }).first();
    await expect(more).toBeVisible({ timeout: 8_000 });
    await more.click({ force: true });
    await sleep(300);
    const mockupItem = page.getByRole('menuitem', { name: IMAGE_TOOL_LABELS.mockup }).or(
      page.getByRole('button', { name: IMAGE_TOOL_LABELS.mockup })
    );
    await expect(mockupItem.first()).toBeVisible({ timeout: 8_000 });
  });
});
