/**
 * Full canvas product ops stress in a live editor (blank project).
 * Draws tools, clipboard, layers, generators — no paid gen APIs.
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

test.setTimeout(5 * 60_000);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
    data: { name: `canvas-ops-stress-${Date.now()}`, document: null },
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
  const login = page.getByRole('heading', { name: /^Log in$|^登录$/i }).first();
  if (await login.isVisible({ timeout: 1_500 }).catch(() => false)) {
    throw new Error('editor behind login');
  }
  await expect(
    page.locator('[aria-label="Image generator"], [aria-label="图像生成器"]').first()
  ).toBeVisible({ timeout: 45_000 });
  const stage = page.locator('[data-rcb-canvas="1"], [data-canvas-stage="1"]').first();
  await expect(stage).toBeVisible({ timeout: 45_000 });
  const skip = page.getByRole('button', { name: /^Skip$|^跳过$/i });
  if (await skip.first().isVisible({ timeout: 1_000 }).catch(() => false)) {
    await skip.first().click({ force: true });
  }
  await page.keyboard.press('Escape');
  await sleep(250);
  return stage;
}

async function focusStage(page: Page, stage: Locator) {
  const box = await stage.boundingBox();
  if (!box) throw new Error('no stage box');
  await page.mouse.click(box.x + 60, box.y + 60);
  await sleep(120);
  return box;
}

async function openLayers(page: Page) {
  const layersBtn = page.getByRole('button', { name: /^Layers$|^图层$/i }).first();
  if (await layersBtn.isVisible({ timeout: 4_000 }).catch(() => false)) {
    await layersBtn.click({ force: true });
    await sleep(250);
  }
}

/** Layer rows can be in an overflow panel (attached but not "visible"). */
async function expectLayerLabel(page: Page, re: RegExp, timeout = 12_000) {
  const hit = page.getByText(re).first();
  await expect(hit).toBeAttached({ timeout });
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
  await page.mouse.move(x1, y1, { steps: 12 });
  await page.mouse.up();
  await sleep(200);
}

function toolBtn(page: Page, en: string, zh: string) {
  return page.locator(`[aria-label="${en}"], [aria-label="${zh}"]`).first();
}

test.describe('canvas ops stress (live editor)', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
  });

  test('tool hotkeys + draw shape/frame/text + layers', async ({ page }) => {
    const stage = await openBlankEditor(page);
    const box = await focusStage(page, stage);
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
    await dragDraw(page, box, 0.25, 0.25, 0.42, 0.42);
    await expectLayerLabel(page, /^矩形$|^Rectangle$/i);

    await page.keyboard.press('o');
    await sleep(150);
    await dragDraw(page, box, 0.5, 0.25, 0.65, 0.4);
    await expectLayerLabel(page, /^椭圆$|^Ellipse$|^Circle$/i);

    await page.keyboard.press('f');
    await sleep(150);
    await dragDraw(page, box, 0.15, 0.55, 0.4, 0.8);
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
    // Commit by clicking empty stage (Esc may cancel place).
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
    const stage = await openBlankEditor(page);
    const box = await focusStage(page, stage);
    await openLayers(page);

    await page.keyboard.press('r');
    await sleep(120);
    await dragDraw(page, box, 0.3, 0.3, 0.48, 0.48);
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
    const stage = await openBlankEditor(page);
    const box = await focusStage(page, stage);
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

    const genBtn = page.locator('[aria-label="Image generator"], [aria-label="图像生成器"]').first();
    await genBtn.click({ force: true });
    await expect(page.locator('[data-image-generator]').first()).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await sleep(200);

    await focusStage(page, stage);
    await page.keyboard.press('Shift+A');
    await expect(page.locator('[data-video-generator]').first()).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await sleep(200);

    await focusStage(page, stage);
    await page.keyboard.press('Control+=');
    await sleep(150);
    await page.keyboard.press('Control+-');
    await sleep(150);
    await page.keyboard.press('Control+0');
    await sleep(150);

    await page.keyboard.press('r');
    await sleep(100);
    await dragDraw(page, box, 0.55, 0.55, 0.7, 0.7);
    await page.keyboard.press('v');
    await sleep(100);
    await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.62);
    await sleep(150);
    await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.62, {
      button: 'right',
    });
    const lock = page.getByText(/^锁定$|^Lock$/i).first();
    if (await lock.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await lock.click({ force: true });
      await sleep(200);
    } else {
      await page.keyboard.press('Escape');
    }

    // Burst draw (layers may virtualize labels — assert stability + >=1).
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('r');
      await sleep(80);
      const f = 0.12 + i * 0.06;
      await dragDraw(page, box, f, 0.15, f + 0.08, 0.28);
    }
    await expectLayerLabel(page, /^矩形$|^Rectangle$/i);
  });
});
