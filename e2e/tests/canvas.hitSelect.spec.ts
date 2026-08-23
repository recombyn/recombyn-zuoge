/**
 * Live repro: click select + marquee select (measured, not guessed).
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

test.setTimeout(3 * 60_000);

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
    data: { name: `hit-select-${Date.now()}`, document: null },
    timeout: 30_000,
  });
  if (!res.ok()) throw new Error(`create project ${res.status()}`);
  const json = await res.json();
  const id = String(json?.project?.id || json?.id || '').trim();
  if (!id) throw new Error('missing project id');
  await page.goto(`/editor/${id}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await expect(page).toHaveURL(new RegExp(`/editor/${id}`), { timeout: 45_000 });
  await dismissBlockingDialogs(page);
  const stage = page.locator('[data-rcb-canvas="1"], [data-canvas-stage="1"]').first();
  await expect(stage).toBeVisible({ timeout: 45_000 });
  await page.keyboard.press('Escape');
  await sleep(400);
  await expect(page).toHaveURL(/\/editor\//);
  return stage;
}

/** Stage bbox is often full viewport — never click the left rail. */
async function focusStage(page: Page, stage: Locator) {
  const box = await stage.boundingBox();
  if (!box) throw new Error('no stage box');
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await sleep(120);
  return box;
}

async function dragDraw(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  x0r: number,
  y0r: number,
  x1r: number,
  y1r: number
) {
  const x0 = box.x + box.width * x0r;
  const y0 = box.y + box.height * y0r;
  const x1 = box.x + box.width * x1r;
  const y1 = box.y + box.height * y1r;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 18 });
  await page.mouse.up();
  await sleep(400);
}

async function chromeCount(page: Page) {
  return page.locator('[data-rcb-sel-box], [data-rcb-sel-chrome], [data-rcb-screen-chrome="1"]').count();
}

async function sceneProbe(page: Page) {
  return page.evaluate(() => {
    const world = document.querySelector('[data-rcb-world="1"]') as HTMLElement | null;
    const nodes = Array.from(document.querySelectorAll('[data-scene-node-id]'));
    const hitPads = document.querySelectorAll('[data-rcb-hit-pad], [data-rcb-hit-dom]');
    const hitLayer = document.querySelector('[data-rcb-hit-pad-layer]');
    return {
      url: location.href,
      hasCanvas: Boolean(document.querySelector('[data-rcb-canvas="1"]')),
      worldTf: world?.style?.transform || '',
      sceneNodeDom: nodes.length,
      sceneNodeIds: nodes.map((n) => n.getAttribute('data-scene-node-id')).slice(0, 12),
      hitPadCount: hitPads.length,
      hitLayerAlive: Boolean(hitLayer),
      hitLayerUnderWorld: Boolean(hitLayer?.closest('[data-rcb-world="1"]')),
      chrome: {
        selBox: document.querySelectorAll('[data-rcb-sel-box]').length,
        selChrome: document.querySelectorAll('[data-rcb-sel-chrome]').length,
        screenChrome: document.querySelectorAll('[data-rcb-screen-chrome]').length,
      },
    };
  });
}

test.describe('canvas hit / marquee (live)', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
  });

  test('click + marquee select two rects', async ({ page }) => {
    const stage = await openBlankEditor(page);
    const box = await focusStage(page, stage);
    expect(page.url()).toMatch(/\/editor\//);

    // Draw two rects (ratios stay away from left rail).
    await page.keyboard.press('r');
    await sleep(120);
    await dragDraw(page, box, 0.28, 0.28, 0.42, 0.42);
    const afterDraw1 = await sceneProbe(page);
    // eslint-disable-next-line no-console
    console.log('[e2e:hit] after draw1', JSON.stringify(afterDraw1));
    expect(afterDraw1.url).toMatch(/\/editor\//);
    expect(afterDraw1.sceneNodeDom).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => chromeCount(page), { timeout: 8_000 }).toBeGreaterThan(0);

    await page.keyboard.press('r');
    await sleep(120);
    await dragDraw(page, box, 0.5, 0.3, 0.64, 0.44);
    const afterDraw2 = await sceneProbe(page);
    // eslint-disable-next-line no-console
    console.log('[e2e:hit] after draw2', JSON.stringify(afterDraw2));
    expect(afterDraw2.sceneNodeDom).toBeGreaterThanOrEqual(2);

    // Clear selection on empty canvas (not left rail).
    await page.keyboard.press('v');
    await sleep(100);
    await page.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.85);
    await sleep(250);
    const afterClear = await sceneProbe(page);
    // eslint-disable-next-line no-console
    console.log('[e2e:hit] after clear', JSON.stringify(afterClear));
    expect(afterClear.url).toMatch(/\/editor\//);
    expect(await chromeCount(page)).toBe(0);

    // Click the first node's actual ink bbox (not guessed fractions).
    const target = await page.evaluate(() => {
      const el = document.querySelector('[data-scene-node-id]') as SVGGraphicsElement | null;
      if (!el || typeof el.getBoundingClientRect !== 'function') return null;
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-scene-node-id'),
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        w: r.width,
        h: r.height,
        left: r.left,
        top: r.top,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[e2e:hit] click target', JSON.stringify(target));
    expect(target).toBeTruthy();
    expect(target!.w).toBeGreaterThan(2);
    expect(target!.h).toBeGreaterThan(2);

    const hitProbe = await page.evaluate(({ cx, cy, id }) => {
      const stage = document.querySelector('[data-rcb-canvas="1"]') as HTMLElement | null;
      const world = document.querySelector('[data-rcb-world="1"]') as HTMLElement | null;
      const tf = world?.style?.transform || '';
      const panM = /translate\(\s*([-.\d]+)px,\s*([-.\d]+)px\)/.exec(tf);
      const zM = /scale\(([^)]+)\)/.exec(tf);
      const panX = panM ? Number(panM[1]) : 0;
      const panY = panM ? Number(panM[2]) : 0;
      const z = zM ? Number(zM[1]) : 1;
      const stageR = stage?.getBoundingClientRect();
      const localX = stageR ? cx - stageR.left : cx;
      const localY = stageR ? cy - stageR.top : cy;
      const sceneX = (localX - panX) / z;
      const sceneY = (localY - panY) / z;
      const n = document.querySelector(
        `[data-scene-node-id="${CSS.escape(id)}"]`
      ) as SVGElement & {
        __sceneLeft?: number;
        __sceneTop?: number;
        sceneWidth?: number;
        sceneHeight?: number;
      } | null;
      const t = n?.getAttribute?.('transform') || '';
      const m = /translate\(\s*([-\d.eE+]+)\s*[, ]\s*([-\d.eE+]+)/.exec(t);
      const host = n
        ? {
            tf: t,
            left: m ? Number(m[1]) : Number(n.__sceneLeft),
            top: m ? Number(m[2]) : Number(n.__sceneTop),
            w: Number(n.sceneWidth),
            h: Number(n.sceneHeight),
          }
        : null;
      const bridge = (window as unknown as { __rcbBridgeHitTest?: Function }).__rcbBridgeHitTest;
      let bridgeHit: string | null = null;
      (window as unknown as { __RCB_HIT_DEBUG__?: boolean }).__RCB_HIT_DEBUG__ = true;
      if (typeof bridge === 'function') {
        try {
          bridgeHit = bridge(sceneX, sceneY, { clientX: cx, clientY: cy });
        } catch (e) {
          bridgeHit = `err:${String(e)}`;
        }
      }
      const last = (window as unknown as { __rcbLastHitDebug?: unknown }).__rcbLastHitDebug;
      const trace = (window as unknown as { __rcbHitTrace?: unknown }).__rcbHitTrace;
      const wrap = (window as unknown as { __rcbBridgeWrap?: unknown }).__rcbBridgeWrap;
      return {
        sceneX,
        sceneY,
        host,
        bridgeHit,
        hasBridge: typeof bridge === 'function',
        last: last ?? null,
        trace: trace ?? null,
        wrap: wrap ?? null,
        stack: document.elementsFromPoint(cx, cy).slice(0, 8).map((el) => ({
          tag: el.tagName,
          pe: getComputedStyle(el).pointerEvents,
          attrs: [...el.attributes]
            .filter((a) => a.name.startsWith('data-'))
            .map((a) => `${a.name}=${a.value}`)
            .slice(0, 6),
        })),
      };
    }, { cx: target!.cx, cy: target!.cy, id: target!.id || '' });
    // eslint-disable-next-line no-console
    console.log('[e2e:hit] hitProbe', JSON.stringify(hitProbe, null, 2));

    await page.mouse.click(target!.cx, target!.cy);
    await sleep(400);
    const afterClick = await sceneProbe(page);
    // eslint-disable-next-line no-console
    console.log('[e2e:hit] after click', JSON.stringify(afterClick));

    // Marquee both regardless of click result — measure both independently.
    await page.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.85);
    await sleep(200);

    const marqueeBox = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('[data-scene-node-id]'));
      let minL = Infinity;
      let minT = Infinity;
      let maxR = -Infinity;
      let maxB = -Infinity;
      for (const n of nodes) {
        const r = (n as Element).getBoundingClientRect();
        minL = Math.min(minL, r.left);
        minT = Math.min(minT, r.top);
        maxR = Math.max(maxR, r.right);
        maxB = Math.max(maxB, r.bottom);
      }
      if (!Number.isFinite(minL)) return null;
      return {
        x0: minL - 30,
        y0: minT - 30,
        x1: maxR + 30,
        y1: maxB + 30,
        count: nodes.length,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[e2e:hit] marquee box', JSON.stringify(marqueeBox));
    expect(marqueeBox).toBeTruthy();
    expect(marqueeBox!.count).toBeGreaterThanOrEqual(2);

    await page.mouse.move(marqueeBox!.x0, marqueeBox!.y0);
    await page.mouse.down();
    await page.mouse.move(marqueeBox!.x1, marqueeBox!.y1, { steps: 28 });
    await page.mouse.up();
    await sleep(450);
    const afterMarquee = await sceneProbe(page);
    // eslint-disable-next-line no-console
    console.log('[e2e:hit] after marquee', JSON.stringify(afterMarquee));

    const clickOk = afterClick.chrome.selBox + afterClick.chrome.selChrome + afterClick.chrome.screenChrome > 0;
    const marqueeOk =
      afterMarquee.chrome.selBox > 0 ||
      afterMarquee.chrome.screenChrome >= 1 ||
      afterMarquee.chrome.selChrome >= 2;

    // eslint-disable-next-line no-console
    console.log('[e2e:hit] RESULT', { clickOk, marqueeOk, afterClick: afterClick.chrome, afterMarquee: afterMarquee.chrome });

    expect(clickOk, 'click-select should show selection chrome').toBe(true);
    expect(marqueeOk, 'marquee-select should show selection chrome').toBe(true);
  });
});
