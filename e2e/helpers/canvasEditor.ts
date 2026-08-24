import path from 'node:path';
import { expect, type Page, type Locator } from '@playwright/test';
import { resolveE2EToken } from '../tests/e2eAuth';

export const ROOT = path.resolve(__dirname, '../..');
export const TOKEN = resolveE2EToken(ROOT);
export const API = (process.env.E2E_API || process.env.FUNC_API || 'http://127.0.0.1:8000').replace(
  /\/$/,
  ''
);

export const IMAGE_TOOL_LABELS = {
  chat: /Recombyn Quick edit|快捷编辑|Quick edit|^Chat$|^聊天$/i,
  mark: /^标记$|^標記$|^Mark$/i,
  removeBg: /^去背景$|^Remove background$/i,
  eraser: /^橡皮工具$|^Eraser$/i,
  editText: /^编辑文字$|^Edit text$/i,
  splitLayers: /^图片分层$|^圖片分層$|^Split layers$/i,
  mockup: /^样机$|^樣機$|^Mockup$/i,
  more: /^更多$|^More$/i,
} as const;

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function makePngBuffer(page: Page, w = 320, h = 240): Promise<Buffer> {
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

export async function injectAuth(page: Page) {
  await page.context().addInitScript((tok) => {
    localStorage.setItem('recombine-auth-token-v1', tok);
    localStorage.setItem('recombyn-editor-tour-v3', '1');
    localStorage.setItem('recombyn-editor-tour-v3:user_super_admin', '1');
  }, TOKEN);
}

export async function seedAuthSession(page: Page) {
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

export async function dismissBlockingDialogs(page: Page) {
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

export async function createBlankProject(page: Page): Promise<string> {
  const res = await page.request.put(`${API}/api/v1/projects`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    data: { name: `intel-tools-${Date.now()}`, document: null },
    timeout: 30_000,
  });
  if (!res.ok()) throw new Error(`create project ${res.status()}`);
  const json = await res.json();
  const id = String(json?.project?.id || json?.id || '').trim();
  if (!id) throw new Error('missing project id');
  return id;
}

export async function openBlankEditor(page: Page): Promise<Locator> {
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
  await page.keyboard.press('Escape');
  await sleep(200);
  return stage;
}

export async function openLayers(page: Page) {
  const layersBtn = page.getByRole('button', { name: /^Layers$|^图层$/i }).first();
  if (await layersBtn.isVisible({ timeout: 4_000 }).catch(() => false)) {
    await layersBtn.click({ force: true });
    await sleep(200);
  }
}

export async function openQuickEdit(page: Page) {
  const chat = page.locator('[data-media-quick-edit-trigger]').first();
  await expect(chat).toBeVisible({ timeout: 12_000 });
  const box = await chat.boundingBox();
  if (!box) throw new Error('quick-edit trigger missing bounding box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('[data-media-quick-edit]').first()).toBeAttached({ timeout: 12_000 });
  // Wait until upload finished and composer is interactive (mark button or prompt).
  const composer = page.locator('[data-media-quick-edit]').first();
  await expect
    .poll(
      async () => {
        const markBtn = composer.getByRole('button', { name: IMAGE_TOOL_LABELS.mark });
        const prompt = composer.locator('[contenteditable="true"], [role="textbox"]').first();
        return (await markBtn.count()) > 0 || (await prompt.count()) > 0;
      },
      { timeout: 30_000 }
    )
    .toBe(true);
}

export async function uploadPngAndSelect(page: Page) {
  const buf = await makePngBuffer(page);
  const input = page.locator('input[type="file"][accept*="image"]').first();
  await expect(input).toBeAttached({ timeout: 10_000 });
  await input.setInputFiles({
    name: `intel-${Date.now()}.png`,
    mimeType: 'image/png',
    buffer: buf,
  });
  await sleep(1_500);
  const mark = page.getByRole('button', { name: IMAGE_TOOL_LABELS.mark }).first();
  if (!(await mark.isVisible({ timeout: 8_000 }).catch(() => false))) {
    const stage = page.locator('[data-rcb-canvas="1"]').first();
    const box = await stage.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45);
      await sleep(400);
    }
  }
  await expect(mark).toBeVisible({ timeout: 25_000 });
}

export async function mockIntelligenceCapabilities(page: Page, opts?: { mockup?: boolean }) {
  await page.route('**/api/v1/image/tools**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ilp: { enabled: true },
        mockup: { enabled: opts?.mockup !== false },
      }),
    });
  });
}

export async function mockImageProcessOk(page: Page) {
  await page.route('**/api/v1/image/process**', async (route) => {
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
            image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          },
        ],
        width: 320,
        height: 240,
        warnings: [],
      }),
    });
  });
}
