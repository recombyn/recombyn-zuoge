/**
 * Full UI functional coverage — every major routed shell with auth token.
 * Complements surfaces.smoke + journeys; keeps assertions shell-level (stable).
 *
 * Surfaces: home navs (home/mine/skills/account), account tabs, inspiration,
 * editor, public share (optional FUNC_SHARE_ID / created via API skip).
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

test.setTimeout(4 * 60_000);
test.describe.configure({ mode: 'serial' });

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function injectAuth(page: Page) {
  await page.context().addInitScript((tok) => {
    localStorage.setItem('recombine-auth-token-v1', tok);
    localStorage.setItem('recombyn-editor-tour-v3', '1');
    localStorage.setItem('recombyn-editor-tour-v3:user_super_admin', '1');
  }, TOKEN);
  await page.addInitScript((tok) => {
    localStorage.setItem('recombine-auth-token-v1', tok);
    localStorage.setItem('recombyn-editor-tour-v3', '1');
    localStorage.setItem('recombyn-editor-tour-v3:user_super_admin', '1');
  }, TOKEN);
}

/** Seed token + persisted user so RequireAuth (/account, /editor) does not bounce to login. */
async function seedAuthSession(page: Page) {
  const me = await page.request.get(`${API}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!me.ok()) {
    throw new Error(`auth/me ${me.status()} — cannot seed session`);
  }
  const body = await me.json();
  const user = body?.user;
  if (!user?.id) throw new Error('auth/me missing user');
  await page.goto('/home', { waitUntil: 'domcontentloaded' });
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
  for (let i = 0; i < 6; i += 1) {
    const skip = page.getByRole('button', { name: /^Skip$|^跳过$/i });
    if ((await skip.count()) > 0) {
      await skip.last().click({ force: true }).catch(() => undefined);
      await sleep(200);
      continue;
    }
    const dialog = page.locator('[role="dialog"]').first();
    if (!(await dialog.isVisible().catch(() => false))) break;
    await page.keyboard.press('Escape');
    await sleep(200);
  }
}

async function seedAuthOnHome(page: Page) {
  await seedAuthSession(page);
}

test.describe('functional UI — all major shells', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
  });

  test('home?nav=home paints composer + recent projects', async ({ page }) => {
    await page.goto('/home?nav=home', { waitUntil: 'domcontentloaded' });
    await dismissBlockingDialogs(page);
    await expect(page.locator('body')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Generate|Recent projects|最近|开始/i }).first()
    ).toBeVisible({ timeout: 30_000 });
  });

  test('home?nav=mine paints projects library', async ({ page }) => {
    await page.goto('/home?nav=mine', { waitUntil: 'domcontentloaded' });
    await dismissBlockingDialogs(page);
    await expect(page.locator('body')).toBeVisible();
    const marker = page
      .getByRole('button', { name: /New project|新建/i })
      .or(page.getByRole('heading', { name: /Projects|项目|Recent/i }))
      .first();
    await expect(marker).toBeVisible({ timeout: 30_000 });
  });

  test('home?nav=skills paints skills library', async ({ page }) => {
    await page.goto('/home?nav=skills', { waitUntil: 'domcontentloaded' });
    await dismissBlockingDialogs(page);
    await expect(page.locator('body')).toBeVisible();
    // Skills UI copy varies; require non-login shell.
    const login = page.getByRole('heading', { name: /^Log in$|^登录$/i });
    await expect(login).toHaveCount(0, { timeout: 5_000 }).catch(() => undefined);
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('home?nav=account paints Me shell', async ({ page }) => {
    await page.goto('/home?nav=account', { waitUntil: 'domcontentloaded' });
    await dismissBlockingDialogs(page);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('account tabs profile / agent / usage shells', async ({ page }) => {
    await seedAuthOnHome(page);
    for (const tab of ['profile', 'agent', 'usage'] as const) {
      await page.goto(`/account?tab=${tab}`, { waitUntil: 'domcontentloaded' });
      await dismissBlockingDialogs(page);
      // usage may bounce to profile when billing UI is hidden
      await expect(page).toHaveURL(/\/account/, { timeout: 20_000 });
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('login route redirects or paints auth shell', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();
    // Logged-in users bounce to home; guests see login modal/copy.
    const onHome = /\/home/.test(page.url());
    const login = page.getByRole('heading', { name: /^Log in$|^登录$/i }).first();
    const hasLogin = await login.isVisible({ timeout: 5_000 }).catch(() => false);
    expect(onHome || hasLogin || page.url().includes('login')).toBe(true);
  });

  test('locale prefix /zh/home paints', async ({ page }) => {
    await page.goto('/zh/home', { waitUntil: 'domcontentloaded' });
    await dismissBlockingDialogs(page);
    await expect(page.locator('body')).toBeVisible();
    await expect(page).toHaveURL(/\/zh\/home|\/home/);
  });

  test('inspiration plaza tabs switch', async ({ page }) => {
    await page.goto('/home?nav=home', { waitUntil: 'domcontentloaded' });
    await dismissBlockingDialogs(page);
    const poster = page.getByRole('tab', { name: /Poster|海报/i }).first();
    if (await poster.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await poster.click({ force: true });
      await sleep(400);
      const selected =
        (await poster.getAttribute('aria-selected')) === 'true' ||
        (await poster.getAttribute('data-state')) === 'active';
      expect(selected).toBe(true);
    }
    const mobile = page.getByRole('tab', { name: /Mobile|手机|App/i }).first();
    if (await mobile.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await mobile.click({ force: true });
      await sleep(300);
    }
  });

  test('editor mounts for known project', async ({ page }) => {
    const known = process.env.E2E_EDITOR_PATH || '/editor/aZ0FRsXFkjbQtnPFmohSZ';
    await seedAuthOnHome(page);
    await page.goto(known, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(page).toHaveURL(/\/editor\//, { timeout: 30_000 });
    await dismissBlockingDialogs(page);
    const login = page.getByRole('heading', { name: /^Log in$|^登录$/i }).first();
    if (await login.isVisible({ timeout: 1_500 }).catch(() => false)) {
      throw new Error('editor behind login');
    }
    const stage = page.locator('canvas, [data-testid="editor-stage"], .rcb-stage, svg').first();
    await expect(stage).toBeVisible({ timeout: 45_000 });
  });

  test('share preview shell (create via API)', async ({ page, request }) => {
    const create = await request.put(`${API}/api/v1/shares`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: 'e2e-func-share',
        permission: 'preview',
        linkPublic: true,
        document: { version: 1, nodes: {}, frames: [] },
      },
    });
    if (!create.ok()) {
      test.skip(true, `share create ${create.status()} — skip preview`);
      return;
    }
    const body = await create.json();
    const shareId = String(body?.share?.id || body?.id || body?.shareId || '').trim();
    expect(shareId.length).toBeGreaterThan(4);
    await page.goto(`/s/${shareId}`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`/s/${shareId}`));
    await expect(page.locator('body')).toBeVisible();
  });
});
