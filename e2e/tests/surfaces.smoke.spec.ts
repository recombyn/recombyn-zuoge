/**
 * Functional surface smoke — auth shell, home/plaza, projects, me, editor mount.
 * Complements journey.* with broader product coverage at low flake risk.
 *
 * Requires: web on E2E_BASE_URL. Authed cases need E2E_TOKEN / .tmp-token.txt.
 */
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { E2E_TOKEN_SKIP_REASON, resolveE2EToken } from './e2eAuth';

const ROOT = path.resolve(__dirname, '../..');
const TOKEN = resolveE2EToken(ROOT);

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
  await page.addInitScript((tok) => {
    localStorage.setItem('recombine-auth-token-v1', tok);
    localStorage.setItem('recombyn-editor-tour-v3', '1');
    localStorage.setItem('recombyn-editor-tour-v3:user_super_admin', '1');
  }, TOKEN);
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

test.describe('surfaces smoke (unauthed)', () => {
  test('auth login shell opens from home login entry', async ({ page }) => {
    // Guest login is routed via ?login=1 (sidebar footer navigates here too).
    await page.goto('/home?login=1', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/home/);
    const loginHeading = page.getByRole('heading', { name: /Log in|登录|Sign up|注册/i }).first();
    const getCode = page.getByRole('button', { name: /Get code|获取验证码|发送验证码/i }).first();
    const emailPh = page.getByPlaceholder(/Email|邮箱/i).first();
    const visible =
      (await loginHeading.isVisible({ timeout: 8_000 }).catch(() => false)) ||
      (await getCode.isVisible({ timeout: 2_000 }).catch(() => false)) ||
      (await emailPh.isVisible({ timeout: 2_000 }).catch(() => false));
    expect(visible).toBe(true);
  });
});

test.describe('surfaces smoke (authed)', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
  });

  test('home: recent projects + inspiration tabs', async ({ page }) => {
    await page.goto('/home', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/home/, { timeout: 60_000 });
    await dismissBlockingDialogs(page);
    await expect(
      page.getByRole('heading', { name: /Recent|最近/i }).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /New project|新建/i }).first()).toBeVisible({
      timeout: 15_000,
    });

    const inspiration = page.getByRole('heading', { name: /Inspiration|灵感|广场/i }).first();
    if (await inspiration.isVisible({ timeout: 8_000 }).catch(() => false)) {
      const posterTab = page.getByRole('tab', { name: /Poster|海报/i }).first();
      if (await posterTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await posterTab.click({ force: true });
        await sleep(400);
        const selected =
          (await posterTab.getAttribute('aria-selected')) === 'true' ||
          (await posterTab.getAttribute('data-state')) === 'active';
        expect(selected).toBe(true);
      }
    }
  });

  test('nav: home rail tabs paint', async ({ page }) => {
    await page.goto('/home', { waitUntil: 'domcontentloaded' });
    await dismissBlockingDialogs(page);

    const projectsNav = page.getByRole('button', { name: /^Projects$|^项目$/i }).first();
    await expect(projectsNav).toBeVisible({ timeout: 20_000 });
    await projectsNav.click({ force: true });
    await sleep(600);
    await expect(page.locator('body')).toBeVisible();

    const skillsNav = page.getByRole('button', { name: /^Skills$|^技能/i }).first();
    await expect(skillsNav).toBeVisible({ timeout: 15_000 });
    await skillsNav.click({ force: true });
    await sleep(600);
    await expect(page.locator('body')).toBeVisible();
  });

  test('editor: known project mounts canvas host', async ({ page }) => {
    const known = process.env.E2E_EDITOR_PATH || '/editor/aZ0FRsXFkjbQtnPFmohSZ';
    // Seed storage on a same-origin document before editor navigation (initScript can race).
    await page.goto('/home', { waitUntil: 'domcontentloaded' });
    await page.evaluate((tok) => {
      localStorage.setItem('recombine-auth-token-v1', tok);
      localStorage.setItem('recombyn-editor-tour-v3', '1');
      localStorage.setItem('recombyn-editor-tour-v3:user_super_admin', '1');
    }, TOKEN);
    await page.goto(known, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(page).toHaveURL(/\/editor\//, { timeout: 30_000 });
    await dismissBlockingDialogs(page);
    await expect(page.locator('body')).toBeVisible();
    const login = page.getByRole('heading', { name: /^Log in$|^登录$/i }).first();
    if (await login.isVisible({ timeout: 1_500 }).catch(() => false)) {
      throw new Error('editor opened behind login — auth token not applied');
    }
    const stage = page.locator('canvas, [data-testid="editor-stage"], .rcb-stage, svg').first();
    await expect(stage).toBeVisible({ timeout: 45_000 });
  });
});
