/**
 * Real Chromium: blank editor → inject N SoA shapes → host counts + pan FPS.
 * Headed: `npx playwright test tests/canvas.soa10k.browser.spec.ts --headed --workers=1`
 * Count: `SOA_BROWSER_N=10000` (default 10000).
 */
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { E2E_TOKEN_SKIP_REASON, resolveE2EToken } from './e2eAuth';

const ROOT = path.resolve(__dirname, '../..');
const TOKEN = resolveE2EToken(ROOT);
const API = (process.env.E2E_API || process.env.FUNC_API || 'http://127.0.0.1:8000').replace(
  /\/$/,
  ''
);
const COUNT = Math.max(150, Number(process.env.SOA_BROWSER_N || 10_000) || 10_000);

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

async function openBlankEditor(page: Page) {
  await seedAuthSession(page);
  const res = await page.request.put(`${API}/api/v1/projects`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    data: { name: `soa-browser-${Date.now()}`, document: null },
    timeout: 30_000,
  });
  if (!res.ok()) throw new Error(`create project ${res.status()} ${await res.text()}`);
  const json = await res.json();
  const id = String(json?.project?.id || json?.id || '').trim();
  if (!id) throw new Error('missing project id');
  await page.goto(`/editor/${id}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await expect(page).toHaveURL(new RegExp(`/editor/${id}`), { timeout: 45_000 });
  await dismissBlockingDialogs(page);
  const stage = page.locator('[data-rcb-canvas="1"], [data-canvas-stage="1"]').first();
  await expect(stage).toBeVisible({ timeout: 45_000 });
  await page.keyboard.press('Escape');
  await sleep(300);
  return { stage, id };
}

async function injectStressDoc(page: Page, n: number, kind: 'rect' | 'polygon') {
  return page.evaluate(
    async ({ n: count, kind: shapeKind }) => {
      const mod = await import('/src/store/modules/editor.ts');
      const setDocument = (mod as { setDocument: (doc: unknown) => void }).setDocument;
      if (typeof setDocument !== 'function') {
        throw new Error('setDocument not exported from editor module');
      }
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      const cell = 28;
      const boardW = cols * cell + 64;
      const boardH = rows * cell + 64;
      const children: string[] = [];
      const deltaSetLike: Record<string, unknown> = {
        ROOT: {
          id: 'ROOT',
          key: 'entry',
          children,
          attrs: {},
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        },
      };
      for (let i = 0; i < count; i += 1) {
        const id = `s${i}`;
        children.push(id);
        deltaSetLike[id] = {
          id,
          key: 'shape',
          x: (i % cols) * cell,
          y: Math.floor(i / cols) * cell,
          width: 48,
          height: 48,
          attrs: {
            shapeType: shapeKind === 'polygon' ? 'polygon' : 'rect',
            ...(shapeKind === 'polygon' ? { sides: 6 } : {}),
            'fill-color': '#ffffff',
            'border-color': '#111111',
            'border-width': 1,
            frameId: 'board',
            frameOrder: i,
          },
          children: [],
        };
      }
      const t0 = performance.now();
      setDocument({
        x: 0,
        y: 0,
        width: boardW,
        height: boardH,
        backgroundColor: '',
        frames: [
          {
            id: 'board',
            name: 'Board',
            x: 0,
            y: 0,
            width: boardW,
            height: boardH,
            clipContent: true,
            kind: 'artboard',
          },
        ],
        activeFrameId: 'board',
        pages: [{ id: 'page1', name: 'Page 1', children: children.slice() }],
        activePageId: 'page1',
        deltaSetLike,
        stackOrder: ['frame:board'],
      });
      return { setDocumentMs: performance.now() - t0 };
    },
    { n, kind }
  );
}

async function readCounts(page: Page) {
  return page.evaluate(() => {
    const layer = document.querySelector('[data-rcb-shapes-layer="1"]');
    const rcb = document.querySelector('[data-rcb-canvas="1"]');
    return {
      fullHost: Number(layer?.getAttribute('data-rcb-full-host-count') || -1),
      canvasIdle: Number(
        layer?.getAttribute('data-rcb-canvas-idle-count') ||
          rcb?.getAttribute('data-rcb-canvas-idle-count') ||
          -1
      ),
      visible: Number(layer?.getAttribute('data-rcb-visible-count') || -1),
      hasInkCanvas: Boolean(document.querySelector('[data-rcb-idle-ink-canvas]')),
      sceneNodeHosts: document.querySelectorAll('[data-scene-node-id]').length,
    };
  });
}

async function measurePanFps(page: Page, stage: Locator) {
  const box = await stage.boundingBox();
  if (!box) throw new Error('no stage box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.keyboard.down(' ');
  await page.mouse.down();
  const measuring = page.evaluate(async () => {
    const dts: number[] = [];
    let last = performance.now();
    for (let i = 0; i < 50; i += 1) {
      await new Promise<number>((r) => requestAnimationFrame(r));
      const now = performance.now();
      dts.push(now - last);
      last = now;
    }
    return dts.slice(8);
  });
  for (let i = 0; i < 24; i += 1) {
    await page.mouse.move(cx + i * 22, cy + ((i % 3) - 1) * 14);
    await sleep(16);
  }
  await page.mouse.up();
  await page.keyboard.up(' ');
  const dts = await measuring;
  const avg = dts.reduce((a, b) => a + b, 0) / Math.max(1, dts.length);
  const sorted = [...dts].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  return {
    avgFrameMs: Math.round(avg * 100) / 100,
    p95FrameMs: Math.round(p95 * 100) / 100,
    samples: dts.length,
  };
}

test.describe('SoA live editor (browser)', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
  });

  test(`inject ${COUNT} stroked rects — host counts + pan FPS`, async ({ page }) => {
    const { stage } = await openBlankEditor(page);

    const tInj0 = Date.now();
    const inj = await injectStressDoc(page, COUNT, 'rect');
    const injectWallMs = Date.now() - tInj0;

    await expect
      .poll(async () => (await readCounts(page)).hasInkCanvas, { timeout: 90_000 })
      .toBe(true);
    await expect
      .poll(async () => (await readCounts(page)).canvasIdle, { timeout: 90_000 })
      .toBeGreaterThan(0);
    await sleep(800);

    const counts = await readCounts(page);
    const pan = await measurePanFps(page, stage);
    const report = {
      n: COUNT,
      setDocumentMs: Math.round(inj.setDocumentMs * 10) / 10,
      injectWallMs,
      counts,
      pan,
    };
    // eslint-disable-next-line no-console
    console.log('[e2e:soa-browser]', JSON.stringify(report, null, 2));
    writeFileSync(
      path.resolve(__dirname, 'canvas.soa10k.browser.results.json'),
      JSON.stringify(report, null, 2),
      'utf8'
    );
    await page.screenshot({
      path: path.resolve(__dirname, 'canvas.soa10k.browser.png'),
      fullPage: false,
    });

    expect(counts.hasInkCanvas).toBe(true);
    expect(counts.fullHost).toBeLessThanOrEqual(96);
    expect(counts.canvasIdle).toBeGreaterThan(0);
  });
});
