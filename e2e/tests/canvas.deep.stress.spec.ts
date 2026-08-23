/**
 * Deep canvas stress — fills gaps beyond generators/ops smoke:
 * upload image, mark-region drag preview, move/resize, export,
 * multi-shape hotkeys, group/lock/hide, align + boolean toolbar.
 */
import path from 'node:path';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { E2E_TOKEN_SKIP_REASON, resolveE2EToken } from './e2eAuth';

const ROOT = path.resolve(__dirname, '../..');
const TOKEN = resolveE2EToken(ROOT);
const API = (process.env.E2E_API || process.env.FUNC_API || 'http://127.0.0.1:8000').replace(
  /\/$/,
  ''
);

test.setTimeout(6 * 60_000);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Solid PNG via an off-DOM canvas screenshot (large enough for mark MIN_MARK). */
async function makePngBuffer(page: Page, w = 320, h = 240): Promise<Buffer> {
  const tmp = await page.context().newPage();
  try {
    await tmp.setContent(
      `<!doctype html><canvas id="c" width="${w}" height="${h}"></canvas>
       <script>
         const c = document.getElementById('c');
         const x = c.getContext('2d');
         x.fillStyle = '#94a3b8';
         x.fillRect(0, 0, ${w}, ${h});
         x.fillStyle = '#2563eb';
         x.fillRect(40, 40, 120, 80);
         x.fillStyle = '#f59e0b';
         x.beginPath(); x.arc(220, 140, 50, 0, Math.PI * 2); x.fill();
       </script>`,
      { waitUntil: 'domcontentloaded' }
    );
    return await tmp.locator('#c').screenshot({ type: 'png' });
  } finally {
    await tmp.close();
  }
}

async function injectAuth(page: Page) {
  await page.context().addInitScript((tok) => {
    localStorage.setItem('recombine-auth-token-v1', tok);
    localStorage.setItem('recombyn-editor-tour-v3', '1');
    localStorage.setItem('recombyn-editor-tour-v3:user_super_admin', '1');
  }, TOKEN);
}

async function seedAuthSession(page: Page) {
  const me = await page.request.get(`${API}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    timeout: 20_000,
  });
  if (!me.ok()) throw new Error(`auth/me ${me.status()}`);
  const body = await me.json();
  const user = body?.user;
  if (!user?.id) throw new Error('auth/me missing user');
  await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.evaluate(
    ({ tok, user: u }) => {
      localStorage.setItem('recombine-auth-token-v1', tok);
      localStorage.setItem('resume-scene-auth-v1', JSON.stringify({ user: u }));
      localStorage.setItem('recombyn-editor-tour-v3', '1');
      localStorage.setItem('recombyn-editor-tour-v3:user_super_admin', '1');
    },
    { tok: TOKEN, user }
  );
}

async function dismissBlockingDialogs(page: Page) {
  for (let i = 0; i < 8; i += 1) {
    const skip = page.getByRole('button', { name: /^Skip$|^跳过$/i });
    if ((await skip.count()) > 0) {
      await skip.last().click({ force: true }).catch(() => undefined);
      await sleep(150);
      continue;
    }
    const dialog = page.locator('[role="dialog"]').first();
    if (!(await dialog.isVisible().catch(() => false))) break;
    await page.keyboard.press('Escape');
    await sleep(150);
  }
}

async function createBlankProject(page: Page): Promise<string> {
  const res = await page.request.put(`${API}/api/v1/projects`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    data: { name: `canvas-deep-${Date.now()}`, document: null },
    timeout: 30_000,
  });
  if (!res.ok()) throw new Error(`create project ${res.status()}`);
  const json = await res.json();
  const id = String(json?.project?.id || json?.id || '').trim();
  if (!id) throw new Error('missing project id');
  return id;
}

async function openBlankEditor(page: Page) {
  await seedAuthSession(page);
  const id = await createBlankProject(page);
  await page.goto(`/editor/${id}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await expect(page).toHaveURL(/\/editor\//, { timeout: 45_000 });
  await dismissBlockingDialogs(page);
  if (
    await page
      .getByRole('heading', { name: /^Log in$|^登录$/i })
      .first()
      .isVisible({ timeout: 1_500 })
      .catch(() => false)
  ) {
    throw new Error('editor behind login');
  }
  await expect(
    page.locator('[aria-label="Image generator"], [aria-label="图像生成器"]').first()
  ).toBeVisible({ timeout: 45_000 });
  const stage = page.locator('[data-rcb-canvas="1"], [data-canvas-stage="1"]').first();
  await expect(stage).toBeVisible({ timeout: 45_000 });
  const skip = page.getByRole('button', { name: /^Skip$|^跳过$/i });
  if (await skip.first().isVisible({ timeout: 800 }).catch(() => false)) {
    await skip.first().click({ force: true });
  }
  await page.keyboard.press('Escape');
  await sleep(200);
  return stage;
}

async function focusStage(page: Page, stage: Locator) {
  const box = await stage.boundingBox();
  if (!box) throw new Error('no stage box');
  // Prefer interior — top-left can sit under chrome / home hit targets after zoom.
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.35);
  await sleep(100);
  return box;
}

async function openLayers(page: Page) {
  const layersBtn = page.getByRole('button', { name: /^Layers$|^图层$/i }).first();
  if (await layersBtn.isVisible({ timeout: 4_000 }).catch(() => false)) {
    await layersBtn.click({ force: true });
    await sleep(200);
  }
}

async function expectLayerLabel(page: Page, re: RegExp, timeout = 12_000) {
  await expect(page.getByText(re).first()).toBeAttached({ timeout });
}

async function dragDraw(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  fx0: number,
  fy0: number,
  fx1: number,
  fy1: number
) {
  const x0 = box.x + box.width * fx0;
  const y0 = box.y + box.height * fy0;
  const x1 = box.x + box.width * fx1;
  const y1 = box.y + box.height * fy1;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 10 });
  await page.mouse.up();
  await sleep(180);
}

async function uploadPngToCanvas(page: Page) {
  const buf = await makePngBuffer(page);
  const input = page.locator('input[type="file"][accept*="image"]').first();
  await expect(input).toBeAttached({ timeout: 10_000 });
  await input.setInputFiles({
    name: `deep-mark-${Date.now()}.png`,
    mimeType: 'image/png',
    buffer: buf,
  });
  // Placeholder then finish upload — wait for image layer / toolbar.
  await expect(
    page.getByText(/^图片$|^Image$|上传中|Uploading/i).first()
  ).toBeAttached({ timeout: 30_000 });
  // Wait until Mark tool can appear (selection toolbar after upload settles).
  await sleep(1_200);
  const mark = page.getByRole('button', { name: /^标记$|^Mark$/i }).first();
  // Click image center-ish if Mark not yet shown.
  if (!(await mark.isVisible({ timeout: 8_000 }).catch(() => false))) {
    const stage = page.locator('[data-rcb-canvas="1"]').first();
    const box = await stage.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45);
      await sleep(400);
    }
  }
  await expect(mark).toBeVisible({ timeout: 25_000 });
  return mark;
}

test.describe('canvas deep stress', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
  });

  test('upload image + mark region shows live draft preview', async ({ page }) => {
    await page.route('**/api/v1/image/process**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ layers: [], width: 320, height: 240, warnings: [] }),
      });
    });

    const stage = await openBlankEditor(page);
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
    // Live draft must appear mid-drag (the bug we fixed).
    await expect(page.locator('[data-mark-draft="1"]').first()).toBeVisible({ timeout: 5_000 });
    await page.mouse.move(x1, y1, { steps: 8 });
    await expect(page.locator('[data-mark-draft="1"]').first()).toBeVisible();
    await page.mouse.up();
    await sleep(400);

    // Draft clears; committed region (badge / label) appears.
    await expect(page.locator('[data-mark-draft="1"]')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByText(/区域|region/i).first()).toBeAttached({ timeout: 10_000 });
  });

  test('shape selected → resize via W dock + nudge', async ({ page }) => {
    const stage = await openBlankEditor(page);
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

    // Selection signal: geometry dock OR rotate knobs (locale-stable).
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
      // Fallback: arrow nudge still exercises transform path.
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowDown');
      await sleep(200);
      await expect(rotate).toBeVisible();
    }
  });

  test('multi-shape + group + ctx lock + export PNG', async ({ page }) => {
    test.setTimeout(3 * 60_000);
    const stage = await openBlankEditor(page);
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

    // Lock via keyboard / ctx — soft.
    await page.keyboard.press('Control+Shift+K');
    await sleep(200);

    // Top-bar Export often present; else context menu.
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
    const stage = await openBlankEditor(page);
    const box = await focusStage(page, stage);
    await openLayers(page);

    await page.keyboard.press('p');
    await sleep(150);
    // Pen draws by click-anchors, not freehand drag — place a few points then Enter.
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
    // Layer naming varies (钢笔 / Path / shape); selection dock is the durable signal.
    const penHit =
      (await page.getByText(/^钢笔$|^Pen$|^路径$|^Path$/i).count()) > 0 ||
      (await page.getByRole('textbox', { name: /^W$/i }).first().isVisible().catch(() => false));
    // Click near stroke to select if needed
    if (!penHit) {
      await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.35);
      await sleep(250);
    }
    await expect(
      page
        .getByRole('textbox', { name: /^W$/i })
        .or(page.getByText(/^钢笔$|^Pen$|^路径$|^Path$|^矩形$/i))
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
    await expect(page.locator('[data-rcb-canvas="1"]').first()).toBeVisible();
  });

  test('frame + text + image generator', async ({ page }) => {
    await openBlankEditor(page);
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
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await sleep(200);

    await page.locator('[aria-label="Image generator"], [aria-label="图像生成器"]').first().click({
      force: true,
    });
    await expect(page.locator('[data-image-generator]').first()).toBeVisible({ timeout: 12_000 });
    await expect(page).toHaveURL(/\/editor\//);
  });
});
