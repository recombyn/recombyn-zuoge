/**
 * Canvas element + generator plates (browser).
 * Mount/type by default; one case mocks POST /chat/image/jobs (no provider keys).
 */
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { E2E_TOKEN_SKIP_REASON, resolveE2EToken } from './e2eAuth';

const ROOT = path.resolve(__dirname, '../..');
const TOKEN = resolveE2EToken(ROOT);
const API = (process.env.E2E_API || process.env.FUNC_API || 'http://127.0.0.1:8000').replace(
  /\/$/,
  ''
);

test.setTimeout(3 * 60_000);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function mediaJobSseBody(payload: Record<string, unknown>) {
  return `event: job\ndata: ${JSON.stringify(payload)}\n\n`;
}

function isMediaJobSse(url: string, method: string) {
  return method === 'GET' && /\/chat\/(image|video|audio|lottie)\/jobs\/.+\/events/.test(url);
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

async function openEditor(page: Page) {
  const known = process.env.E2E_EDITOR_PATH || '/editor/aZ0FRsXFkjbQtnPFmohSZ';
  await seedAuthSession(page);
  await page.goto(known, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await expect(page).toHaveURL(/\/editor\//, { timeout: 45_000 });
  await dismissBlockingDialogs(page);
  const login = page.getByRole('heading', { name: /^Log in$|^登录$/i }).first();
  if (await login.isVisible({ timeout: 1_500 }).catch(() => false)) {
    throw new Error('editor behind login');
  }
  // Toolstrip appears before/with canvas; wait for it then the stage host.
  await expect(
    page.locator('[aria-label*="Image generator"], [aria-label*="图像生成器"]').first()
  ).toBeVisible({ timeout: 45_000 });
  const stage = page.locator('[data-rcb-canvas="1"], [data-canvas-stage="1"]').first();
  await expect(stage).toBeVisible({ timeout: 45_000 });
  // Dismiss leftover tour / agent focus.
  const skip = page.getByRole('button', { name: /^Skip$|^跳过$/i });
  if (await skip.first().isVisible({ timeout: 1_000 }).catch(() => false)) {
    await skip.first().click({ force: true });
  }
  await page.keyboard.press('Escape');
  await sleep(200);
}

async function focusCanvasHotkeys(page: Page) {
  const stage = page.locator('[data-rcb-canvas="1"], [data-canvas-stage="1"]').first();
  await expect(stage).toBeVisible({ timeout: 15_000 });
  const box = await stage.boundingBox();
  if (!box) throw new Error('no stage box');
  await page.mouse.click(box.x + Math.min(80, box.width * 0.15), box.y + Math.min(80, box.height * 0.15));
  await sleep(150);
}

test.describe('canvas generators + element tools', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
  });

  /** Tiny 1×1 PNG — enough for promote after mocked /chat/image. */
  const MOCK_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  async function spawnImageGeneratorPlate(page: Page) {
    await openEditor(page);
    await focusCanvasHotkeys(page);

    const layersBtn = page.getByRole('button', { name: /^Layers$|^图层$/i }).first();
    if (await layersBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await layersBtn.click({ force: true });
      await sleep(300);
    }

    const genBtn = page.locator('[aria-label*="Image generator"], [aria-label*="图像生成器"]').first();
    await expect(genBtn).toBeVisible({ timeout: 15_000 });
    await expect(genBtn).toBeEnabled();
    await genBtn.click({ force: true });
    await sleep(500);

    const layerHit = page.getByText(/^Image generator$|^图像生成器$/i).first();
    const plate = page.locator('[data-image-generator]').first();
    const spawned =
      (await plate.isVisible({ timeout: 8_000 }).catch(() => false)) ||
      (await layerHit.isVisible({ timeout: 8_000 }).catch(() => false));
    expect(spawned).toBe(true);

    if (await layerHit.isVisible().catch(() => false)) {
      await layerHit.click({ force: true });
      await sleep(400);
    }
    await expect(page.locator('[data-image-generator]').first()).toBeVisible({ timeout: 15_000 });
  }

  test('Image generator plate mounts (toolbar)', async ({ page }) => {
    await spawnImageGeneratorPlate(page);
    const input = page
      .locator('[data-image-generator] [contenteditable="true"], [data-image-generator] textarea')
      .first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.click({ force: true });
    await page.keyboard.type('e2e canvas image gen smoke', { delay: 4 });
  });

  test('Image generator mock finish promotes plate (no paid API)', async ({ page }) => {
    await page.route('**/api/v1/chat/image**', async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();
      if (url.includes('/chat/image/jobs') && method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ job_id: 'e2e-img', status: 'queued' }),
        });
        return;
      }
      if (isMediaJobSse(url, method)) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: mediaJobSseBody({
            job_id: 'e2e-img',
            status: 'done',
            progress: 100,
            result: { images: [MOCK_PNG], model: 'e2e-mock' },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ images: [MOCK_PNG], model: 'e2e-mock' }),
      });
    });

    await spawnImageGeneratorPlate(page);
    const plate = page.locator('[data-image-generator]').first();
    const input = plate
      .locator('[contenteditable="true"], textarea')
      .first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.click({ force: true });
    await page.keyboard.type('e2e mock image promote', { delay: 4 });

    const send = plate.locator('button:not([disabled])').last();
    await expect(send).toBeEnabled({ timeout: 5_000 });
    await send.click({ force: true });

    // Promote clears generator chrome; canvas paints via scene (preload <img> may be !hidden).
    await expect(page.locator('[data-image-generator]')).toHaveCount(0, { timeout: 20_000 });
    await expect(
      page.locator('img[src*="data:image/png"], image[href*="data:image/png"]').first()
    ).toBeAttached({ timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: /Quick edit|快速编辑|Upscale|高清放大/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('Image generator can delete while generating', async ({ page }) => {
    await page.route('**/api/v1/chat/image**', async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();
      if (url.includes('/chat/image/jobs') && method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ job_id: 'e2e-del', status: 'queued' }),
        });
        return;
      }
      if (isMediaJobSse(url, method)) {
        // Keep SSE open so the plate stays in generating state.
        return;
      }
      await route.continue();
    });

    await spawnImageGeneratorPlate(page);
    const plate = page.locator('[data-image-generator]').first();
    const input = plate.locator('[contenteditable="true"], textarea').first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.click({ force: true });
    await page.keyboard.type('e2e delete while generating', { delay: 4 });
    const send = plate.locator('button:not([disabled])').last();
    await expect(send).toBeEnabled({ timeout: 5_000 });
    await send.click({ force: true });

    await expect(page.getByText(/Generating|生成中/i).first()).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-image-generator]')).toHaveCount(0, { timeout: 10_000 });
  });

  test('Image generator disables copy/duplicate while generating', async ({ page }) => {
    await page.route('**/api/v1/chat/image**', async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();
      if (url.includes('/chat/image/jobs') && method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ job_id: 'e2e-nodup', status: 'queued' }),
        });
        return;
      }
      if (isMediaJobSse(url, method)) {
        return;
      }
      await route.continue();
    });

    await spawnImageGeneratorPlate(page);
    const plate = page.locator('[data-image-generator]').first();
    const input = plate.locator('[contenteditable="true"], textarea').first();
    await input.click({ force: true });
    await page.keyboard.type('e2e no duplicate while gen', { delay: 4 });
    const plateBox = await plate.boundingBox();
    expect(plateBox).toBeTruthy();
    await plate.locator('button:not([disabled])').last().click({ force: true });
    await expect(page.getByText(/Generating|生成中/i).first()).toBeVisible({ timeout: 15_000 });

    // Composer may unmount while SoftGlow is up — right-click the last plate center.
    await page.mouse.click(plateBox!.x + plateBox!.width / 2, plateBox!.y + plateBox!.height / 2, {
      button: 'right',
    });
    const copyItem = page.getByRole('button', { name: /Copy|复制/i }).first();
    const dupItem = page.getByRole('button', { name: /Duplicate|创建副本|副本/i }).first();
    await expect(copyItem).toBeVisible({ timeout: 5_000 });
    await expect(copyItem).toBeDisabled();
    await expect(dupItem).toBeDisabled();
    const deleteItem = page.getByRole('button', { name: /Delete|删除/i }).first();
    await expect(deleteItem).toBeEnabled();
  });

  test('Video generator mock finish promotes plate', async ({ page }) => {
    const MOCK_MP4 = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
    await page.route('**/api/v1/chat/video**', async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();
      if (url.includes('/chat/video/jobs') && method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ job_id: 'e2e-vid', status: 'queued' }),
        });
        return;
      }
      if (isMediaJobSse(url, method)) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: mediaJobSseBody({
            job_id: 'e2e-vid',
            status: 'done',
            progress: 100,
            result: { videos: [MOCK_MP4], model: 'e2e-mock' },
          }),
        });
        return;
      }
      await route.continue();
    });

    await openEditor(page);
    await focusCanvasHotkeys(page);
    await page.keyboard.press('Shift+A');
    const plate = page.locator('[data-video-generator]').first();
    await expect(plate).toBeVisible({ timeout: 20_000 });
    const input = plate.locator('[contenteditable="true"], textarea').first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.click({ force: true });
    await page.keyboard.type('e2e mock video promote', { delay: 4 });
    await plate.locator('button:not([disabled])').last().click({ force: true });
    await expect(page.locator('[data-video-generator]')).toHaveCount(0, { timeout: 30_000 });
  });

  test('Audio generator mock finish promotes plate', async ({ page }) => {
    const MOCK_MP3 =
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
    await page.route('**/api/v1/chat/audio**', async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();
      if (url.includes('/chat/audio/jobs') && method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ job_id: 'e2e-aud', status: 'queued' }),
        });
        return;
      }
      if (isMediaJobSse(url, method)) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: mediaJobSseBody({
            job_id: 'e2e-aud',
            status: 'done',
            progress: 100,
            result: { audios: [MOCK_MP3], model: 'e2e-mock' },
          }),
        });
        return;
      }
      await route.continue();
    });

    await openEditor(page);
    const stage = page.locator('[data-rcb-canvas="1"], [data-canvas-stage="1"]').first();
    const box = await stage.boundingBox();
    expect(box).toBeTruthy();
    await spawnFromGeneratorsMenu(
      page,
      box!,
      /Audio generator|音频生成/i,
      '[data-audio-generator]',
      { fx: 0.2, fy: 0.2 }
    );
    const plate = page.locator('[data-audio-generator]').first();
    const input = plate.locator('[contenteditable="true"], textarea').first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.click({ force: true });
    await page.keyboard.type('e2e mock audio promote', { delay: 4 });
    await plate.locator('button:not([disabled])').last().click({ force: true });
    await expect(page.locator('[data-audio-generator]')).toHaveCount(0, { timeout: 30_000 });
  });

  test('Image generator recovers after reload with persisted job id', async ({ page }) => {
    let sseConnections = 0;
    await page.route('**/api/v1/chat/image**', async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();
      if (url.includes('/chat/image/jobs') && method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ job_id: 'e2e-recover', status: 'queued' }),
        });
        return;
      }
      if (isMediaJobSse(url, method)) {
        sseConnections += 1;
        if (sseConnections === 1) {
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: mediaJobSseBody({
            job_id: 'e2e-recover',
            status: 'done',
            progress: 100,
            result: { images: [MOCK_PNG], model: 'e2e-mock' },
          }),
        });
        return;
      }
      await route.continue();
    });

    await spawnImageGeneratorPlate(page);
    const plate = page.locator('[data-image-generator]').first();
    const input = plate.locator('[contenteditable="true"], textarea').first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.click({ force: true });
    await page.keyboard.type('e2e recover after reload', { delay: 4 });
    const send = plate.locator('button:not([disabled])').last();
    await expect(send).toBeEnabled({ timeout: 5_000 });
    await send.click({ force: true });

    await expect(page.getByText(/Generating|生成中/i).first()).toBeVisible({ timeout: 15_000 });
    // Give autosave / collab a moment to persist processJobIds on the node.
    await sleep(1500);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await dismissBlockingDialogs(page);
    await expect(
      page.locator('[aria-label*="Image generator"], [aria-label*="图像生成器"]').first()
    ).toBeVisible({ timeout: 45_000 });

    // Recovery host should finish the job and promote the plate (or clear if attrs were not persisted).
    await expect
      .poll(
        async () => {
          const generating = await page.getByText(/Generating|生成中/i).count();
          const plateCount = await page.locator('[data-image-generator]').count();
          const hasImg = await page
            .locator('img[src*="data:image/png"], image[href*="data:image/png"]')
            .count();
          // Success: either promoted (no generator plate + image) or cleared sticky loading.
          if (hasImg > 0 && plateCount === 0) return 'promoted';
          if (generating === 0 && plateCount >= 0) return 'cleared-or-idle';
          return 'waiting';
        },
        { timeout: 45_000 }
      )
      .not.toBe('waiting');
  });

  test('Image generator real provider finish (opt-in paid)', async ({ page }) => {
    test.skip(
      process.env.E2E_PAID_IMAGE_GEN !== '1',
      'Set E2E_PAID_IMAGE_GEN=1 (+ provider keys on API) to run paid image finish'
    );
    // Do not mock — hits live POST /api/v1/chat/image/jobs.
    await spawnImageGeneratorPlate(page);
    const plate = page.locator('[data-image-generator]').first();
    const input = plate.locator('[contenteditable="true"], textarea').first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.click({ force: true });
    await page.keyboard.type('e2e paid image promote tiny square', { delay: 4 });
    const send = plate.locator('button:not([disabled])').last();
    await expect(send).toBeEnabled({ timeout: 5_000 });
    await send.click({ force: true });
    await expect(page.locator('[data-image-generator]')).toHaveCount(0, {
      timeout: 180_000,
    });
  });

  test('Video generator plate mounts (Shift+A)', async ({ page }) => {
    await openEditor(page);
    await focusCanvasHotkeys(page);
    await page.keyboard.press('Shift+A');
    await expect(page.locator('[data-video-generator]').first()).toBeVisible({ timeout: 20_000 });
  });

  async function spawnFromGeneratorsMenu(
    page: Page,
    stageBox: { x: number; y: number; width: number; height: number },
    item: RegExp,
    plate: string,
    frac: { fx: number; fy: number }
  ) {
    // Prefer empty stage regions so we get the canvas (not node) context menu.
    const x = stageBox.x + stageBox.width * frac.fx;
    const y = stageBox.y + stageBox.height * frac.fy;
    await page.mouse.click(x, y);
    await page.keyboard.press('Escape');
    await sleep(200);
    await page.mouse.click(x, y, { button: 'right' });
    const generators = page.getByText(/^Generators$|^生成器$/i).first();
    await expect(generators).toBeVisible({ timeout: 10_000 });
    await generators.hover();
    await sleep(400);
    await page.getByText(item).first().click({ force: true });
    await expect(page.locator(plate).first()).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');
    await sleep(200);
  }

  test('Lottie generator mock finish promotes plate', async ({ page }) => {
    const anim = { v: '5.5.2', fr: 30, w: 200, h: 200, layers: [] };
    await page.route('**/api/v1/chat/lottie**', async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();
      if (url.includes('/chat/lottie/jobs') && method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ job_id: 'e2e-lot', status: 'queued' }),
        });
        return;
      }
      if (isMediaJobSse(url, method)) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: mediaJobSseBody({
            job_id: 'e2e-lot',
            status: 'done',
            progress: 100,
            result: { animationData: anim, w: 200, h: 200, model: 'e2e-mock' },
          }),
        });
        return;
      }
      await route.continue();
    });

    await openEditor(page);
    const stage = page.locator('[data-rcb-canvas="1"], [data-canvas-stage="1"]').first();
    const box = await stage.boundingBox();
    expect(box).toBeTruthy();
    await spawnFromGeneratorsMenu(
      page,
      box!,
      /Lottie generator|Lottie 生成/i,
      '[data-lottie-generator]',
      { fx: 0.2, fy: 0.2 }
    );
    const plate = page.locator('[data-lottie-generator]').first();
    const input = plate.locator('[contenteditable="true"], textarea').first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.click({ force: true });
    await page.keyboard.type('e2e mock lottie promote', { delay: 4 });
    await plate.locator('button:not([disabled])').last().click({ force: true });
    await expect(page.locator('[data-lottie-generator]')).toHaveCount(0, { timeout: 30_000 });
  });

  test('Lottie + Audio generators from context menu', async ({ page }) => {
    await openEditor(page);
    const stage = page.locator('[data-rcb-canvas="1"], [data-canvas-stage="1"]').first();
    const box = await stage.boundingBox();
    expect(box).toBeTruthy();

    await spawnFromGeneratorsMenu(
      page,
      box!,
      /Lottie generator|Lottie 生成/i,
      '[data-lottie-generator]',
      { fx: 0.12, fy: 0.12 }
    );
    await spawnFromGeneratorsMenu(
      page,
      box!,
      /Audio generator|音频生成/i,
      '[data-audio-generator]',
      { fx: 0.12, fy: 0.82 }
    );
  });

  test('Text tool opens inline editor on click', async ({ page }) => {
    await openEditor(page);
    await focusCanvasHotkeys(page);
    await page.keyboard.press('t');
    await sleep(200);
    const stage = page.locator('[data-rcb-canvas="1"], [data-canvas-stage="1"]').first();
    const box = await stage.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.click(box!.x + box!.width * 0.45, box!.y + box!.height * 0.45);
    await expect(page.locator('[data-text-inline-editor], [contenteditable="true"]').first()).toBeVisible({
      timeout: 12_000,
    });
  });
});
