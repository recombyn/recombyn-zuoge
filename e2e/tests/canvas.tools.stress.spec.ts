/**
 * Canvas tools stress — remaining gaps:
 * image AI tool panels, align/boolean hard asserts, density, video trim.
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

async function makePngBuffer(page: Page, w = 320, h = 240): Promise<Buffer> {
  const tmp = await page.context().newPage();
  try {
    await tmp.setContent(
      `<!doctype html><canvas id="c" width="${w}" height="${h}"></canvas>
       <script>
         const c = document.getElementById('c');
         const x = c.getContext('2d');
         x.fillStyle = '#cbd5e1'; x.fillRect(0,0,${w},${h});
         x.fillStyle = '#3b82f6'; x.fillRect(30,30,140,100);
         x.fillStyle = '#f97316'; x.beginPath(); x.arc(230,150,55,0,Math.PI*2); x.fill();
       </script>`,
      { waitUntil: 'domcontentloaded' }
    );
    return await tmp.locator('#c').screenshot({ type: 'png' });
  } finally {
    await tmp.close();
  }
}

/** Short WebM via MediaRecorder (Chromium). */
async function makeWebmBuffer(page: Page): Promise<Buffer | null> {
  const tmp = await page.context().newPage();
  try {
    const b64 = await tmp.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 180;
      document.body.appendChild(c);
      const ctx = c.getContext('2d')!;
      const stream = c.captureStream(15);
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const done = new Promise<Blob>((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      });
      rec.start(50);
      let i = 0;
      await new Promise<void>((resolve) => {
        const id = setInterval(() => {
          ctx.fillStyle = i % 2 ? '#1d4ed8' : '#ea580c';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.fillStyle = '#fff';
          ctx.font = '28px sans-serif';
          ctx.fillText(`f${i}`, 20, 40);
          i += 1;
          if (i >= 12) {
            clearInterval(id);
            rec.stop();
            resolve();
          }
        }, 80);
      });
      const blob = await done;
      const buf = await blob.arrayBuffer();
      let s = '';
      const bytes = new Uint8Array(buf);
      for (let j = 0; j < bytes.length; j += 1) s += String.fromCharCode(bytes[j]!);
      return btoa(s);
    });
    if (!b64) return null;
    return Buffer.from(b64, 'base64');
  } catch {
    return null;
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
    data: { name: `canvas-tools-${Date.now()}`, document: null },
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
  await page.mouse.move(x1, y1, { steps: 8 });
  await page.mouse.up();
  await sleep(120);
}

async function uploadPng(page: Page) {
  const buf = await makePngBuffer(page);
  const input = page.locator('input[type="file"][accept*="image"]').first();
  await expect(input).toBeAttached({ timeout: 10_000 });
  await input.setInputFiles({
    name: `tools-${Date.now()}.png`,
    mimeType: 'image/png',
    buffer: buf,
  });
  await sleep(1_500);
  const mark = page.getByRole('button', { name: /^标记$|^Mark$/i }).first();
  if (!(await mark.isVisible({ timeout: 8_000 }).catch(() => false))) {
    const stage = page.locator('[data-rcb-canvas="1"]').first();
    const box = await stage.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45);
      await sleep(400);
    }
  }
  await expect(page.getByRole('button', { name: /^标记$|^Mark$/i }).first()).toBeVisible({
    timeout: 25_000,
  });
}

test.describe('canvas tools stress', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
  });

  test('image tool panels: eraser / multi-angle / crop / expand / adjust', async ({ page }) => {
    await page.route('**/api/v1/image/process**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ layers: [], width: 320, height: 240, warnings: [] }),
      });
    });

    await openBlankEditor(page);
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
    await expect(
      page.locator('[aria-label="Image generator"], [aria-label="图像生成器"]').first()
    ).toBeVisible();
  });

  test('multi-select align + boolean union hard asserts', async ({ page }) => {
    const stage = await openBlankEditor(page);
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

    // Align group must appear for multi-select.
    const alignGroup = page.getByRole('group', { name: /^对齐$/i }).first();
    await expect(alignGroup).toBeVisible({ timeout: 10_000 });
    const alignLeft = page.getByRole('button', { name: /^左对齐$/i }).first();
    await expect(alignLeft).toBeVisible({ timeout: 5_000 });
    await alignLeft.click({ force: true });
    await sleep(250);

    // Boolean menu
    const boolBtn = page.getByRole('button', { name: /^布尔运算$/i }).first();
    await expect(boolBtn).toBeVisible({ timeout: 8_000 });
    await boolBtn.click({ force: true });
    await sleep(200);
    const union = page.getByText(/^并集$/i).first();
    await expect(union).toBeVisible({ timeout: 5_000 });
    await union.click({ force: true });
    await sleep(500);

    // After union, selection chrome / layers should still be alive.
    await expect(page).toHaveURL(/\/editor\//);
    await expect(
      page.getByRole('textbox', { name: 'W' }).or(page.getByText(/^矩形$|^路径$|^Path$/i)).first()
    ).toBeAttached({ timeout: 10_000 });
  });

  test('density: 30 rapid rects without crash', async ({ page }) => {
    const stage = await openBlankEditor(page);
    const box = await focusStage(page, stage);
    await openLayers(page);

    // Seed one rect, then duplicate (avoids geometry-dock stealing shape hotkeys).
    await page.keyboard.press('Escape');
    await sleep(80);
    await page.keyboard.press('r');
    await sleep(80);
    await dragDraw(page, box, 0.25, 0.25, 0.38, 0.38);
    await expect(page.getByText(/^矩形$|^Rectangle$/i).first()).toBeAttached({
      timeout: 12_000,
    });

    await page.keyboard.press('v');
    await sleep(80);
    await page.mouse.click(box.x + box.width * 0.31, box.y + box.height * 0.31);
    await sleep(200);

    for (let i = 0; i < 29; i += 1) {
      await page.keyboard.press('Control+d');
      await sleep(60);
    }

    // Multi-select proves many nodes exist even if the layer list is virtualized.
    await page.keyboard.press('Escape');
    await sleep(80);
    await page.mouse.click(box.x + 12, box.y + 12);
    await sleep(80);
    await page.keyboard.press('Control+a');
    await sleep(400);
    await expect(page.getByRole('group', { name: /^对齐$/i }).first()).toBeVisible({
      timeout: 12_000,
    });
    await expect(page).toHaveURL(/\/editor\//);
    await expect(
      page.locator('[aria-label="Image generator"], [aria-label="图像生成器"]').first()
    ).toBeVisible();
  });

  test('video upload opens trim toolbar', async ({ page }) => {
    const webm = await makeWebmBuffer(page);
    test.skip(!webm || webm.length < 100, 'MediaRecorder webm unavailable');

    await openBlankEditor(page);
    await openLayers(page);

    const input = page.locator('input[type="file"][accept*="image"]').first();
    await input.setInputFiles({
      name: `tools-${Date.now()}.webm`,
      mimeType: 'video/webm',
      buffer: webm!,
    });
    await sleep(2_000);

    // Select video if toolbar not yet shown.
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
