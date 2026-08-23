/**
 * Live editor: pen snap tip / rubber-band sit on cell-perimeter targets at high zoom.
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

function onPenPerimeter(point: { x: number; y: number }, gridSize: number) {
  const g = gridSize > 0 ? gridSize : 1;
  const x2 = Math.round((point.x / g) * 2);
  const y2 = Math.round((point.y / g) * 2);
  return (
    Math.abs(point.x / g - x2 / 2) < 1e-6 &&
    Math.abs(point.y / g - y2 / 2) < 1e-6 &&
    (x2 % 2 === 0 || y2 % 2 === 0)
  );
}

async function injectAuth(page: Page) {
  await page.context().addInitScript((tok) => {
    localStorage.setItem('recombine-auth-token-v1', tok);
    localStorage.setItem('recombyn-editor-cloud-v3', '1');
    localStorage.setItem('recombyn-editor-cloud-v3:user_super_admin', '1');
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
      localStorage.setItem('recombyn-editor-cloud-v3', '1');
      localStorage.setItem('recombyn-editor-cloud-v3:user_super_admin', '1');
    },
    { tok: TOKEN, user }
  );
}

async function dismissBlockingDialogs(page: Page) {
  for (let i = 0; i < 10; i += 1) {
    const skip = page.getByRole('button', { name: /^Skip$|^跳过$/i });
    if ((await skip.count()) > 0) {
      await skip.last().click({ force: true }).catch(() => undefined);
      await sleep(150);
      continue;
    }
    const tour = page.locator('[role="dialog"][aria-modal="true"]');
    if ((await tour.count()) > 0) {
      const close = tour.locator('button').first();
      await close.click({ force: true }).catch(() => undefined);
      await page.keyboard.press('Escape');
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
    data: { name: `pen-grid-${Date.now()}`, document: null },
    timeout: 30_000,
  });
  if (!res.ok()) throw new Error(`create project ${res.status()}`);
  const json = await res.json();
  const id = String(json?.project?.id || json?.id || '').trim();
  if (!id) throw new Error('missing project id');
  await page.goto(`/editor/${id}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await expect(page).toHaveURL(/\/editor\//, { timeout: 45_000 });
  await dismissBlockingDialogs(page);
  const stage = page.locator('[data-rcb-canvas="1"], [data-canvas-stage="1"]').first();
  await expect(stage).toBeVisible({ timeout: 45_000 });
  await page.keyboard.press('Escape');
  await sleep(200);
  return stage;
}

async function focusStage(page: Page, stage: Locator) {
  const box = await stage.boundingBox();
  if (!box) throw new Error('no stage box');
  await page.mouse.click(box.x + 80, box.y + 80);
  await sleep(120);
  return box;
}

test.describe('canvas pen tip on grid perimeter (high zoom)', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
  });

  test('pen snap tip + rubber end use corners/edge mids, never cell center', async ({ page }) => {
    const stage = await openBlankEditor(page);
    const box = await focusStage(page, stage);

    await page.keyboard.press('p');
    await sleep(200);

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 40; i += 1) {
      await page.evaluate(({ x, y }) => {
        const el = document.querySelector('[data-rcb-canvas="1"]');
        if (!el) return;
        el.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            deltaY: -160,
            ctrlKey: true,
          })
        );
      }, { x: cx, y: cy });
    }
    await sleep(400);

    // Move to a mid-cell client point so raw ≠ lattice.
    const mx = box.x + box.width * 0.42;
    const my = box.y + box.height * 0.38;
    await page.mouse.move(mx, my);
    await sleep(200);

    await expect
      .poll(async () => page.locator('[data-pen-snap-tip="1"]').count(), {
        timeout: 8_000,
      })
      .toBeGreaterThan(0);

    // Place first anchor, then move again — rubber + tip both on lattice.
    await page.mouse.click(mx, my);
    await sleep(200);
    await page.mouse.move(mx + 37, my + 29);
    await sleep(200);

    const report = await page.evaluate(() => {
      const tipG = document.querySelector('[data-pen-snap-tip="1"]') as SVGGElement | null;
      const circle = tipG?.querySelector('circle') as SVGCircleElement | null;
      const tip = circle
        ? { x: Number(circle.getAttribute('cx')), y: Number(circle.getAttribute('cy')) }
        : null;
      const rubber = document.querySelector(
        '[data-pen-draw-preview] line[stroke-dasharray]'
      ) as SVGLineElement | null;
      const rubberEnd = rubber
        ? { x: Number(rubber.getAttribute('x2')), y: Number(rubber.getAttribute('y2')) }
        : null;
      const cameraRoot = document.querySelector('[data-rcb-scene-camera="1"]') as SVGGElement | null;
      const tf = cameraRoot?.getAttribute('transform') || '';
      const zoomMatch = /scale\(([^)]+)\)/.exec(tf);
      const cssZoom = zoomMatch ? Number(zoomMatch[1]) : NaN;
      const gridSize = Number(
        document.querySelector('[data-rcb-grid-size]')?.getAttribute('data-rcb-grid-size') || 1
      );
      return { tip, rubberEnd, cssZoom, gridSize, hasPreview: Boolean(tipG) };
    });

    // eslint-disable-next-line no-console
    console.log('[e2e:pen-grid]', JSON.stringify(report, null, 2));

    expect(report.cssZoom).toBeGreaterThan(8);
    expect(report.tip).not.toBeNull();
    if (!report.tip) return;

    expect(onPenPerimeter(report.tip, report.gridSize)).toBe(true);
    // Forbidden: cell center (½,½).
    const g = report.gridSize > 0 ? report.gridSize : 1;
    const halfX = Math.floor(report.tip.x / g) * g + g / 2;
    const halfY = Math.floor(report.tip.y / g) * g + g / 2;
    expect(
      Math.abs(report.tip.x - halfX) < 1e-6 && Math.abs(report.tip.y - halfY) < 1e-6
    ).toBe(false);

    if (report.rubberEnd) {
      expect(report.rubberEnd.x).toBeCloseTo(report.tip.x, 5);
      expect(report.rubberEnd.y).toBeCloseTo(report.tip.y, 5);
      expect(onPenPerimeter(report.rubberEnd, report.gridSize)).toBe(true);
    }
  });
});
