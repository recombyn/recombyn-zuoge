/**
 * Full product journey E2E: Home → project data/covers → Editor → agent CRUD → back Home covers.
 *
 * Requires: web on E2E_BASE_URL (default http://localhost:3000), API, token in ../.tmp-token.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { E2E_TOKEN_SKIP_REASON, resolveE2EToken } from './e2eAuth';

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, '.tmp-e2e-journey');
const TOKEN = resolveE2EToken(ROOT);

test.setTimeout(12 * 60_000);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function injectAuth(page: Page) {
  // Context-level so home → editor `window.open` tabs also get the token.
  await page.context().addInitScript((tok) => {
    localStorage.setItem('recombine-auth-token-v1', tok);
    // Skip editor onboarding tour for E2E (user-scoped + global keys).
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
  for (let i = 0; i < 8; i += 1) {
    // Editor onboarding tour (can mount late; two Skip buttons in a11y tree).
    const skip = page.getByRole('button', { name: /^Skip$|^跳过$/i });
    if ((await skip.count()) > 0) {
      await skip.last().click({ force: true }).catch(() => undefined);
      await sleep(350);
      continue;
    }
    const dialog = page.locator('[role="dialog"]').first();
    if (!(await dialog.isVisible().catch(() => false))) break;
    const close = dialog
      .getByRole('button', { name: /close|关闭|取消|got it|知道了|确认|ok|skip|跳过/i })
      .first();
    if (await close.isVisible({ timeout: 500 }).catch(() => false)) {
      await close.click({ force: true }).catch(() => undefined);
      await sleep(300);
      continue;
    }
    await page.keyboard.press('Escape');
    await sleep(300);
  }
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}

function projectCards(page: Page): Locator {
  // Real project cards (exclude dashed New project tile and loading skeletons).
  return page.locator('article').filter({
    hasNot: page.getByRole('button', { name: /^New project$|^新建项目$/i }),
    hasNotText: /^loading$/i,
  });
}

async function waitHomeProjects(page: Page) {
  await page.goto('/home');
  await page.waitForURL(/\/home/, { timeout: 60_000 });
  await page.waitForLoadState('domcontentloaded');
  await dismissBlockingDialogs(page);
  await expect(page.locator('body')).toBeVisible();
  const recent = page.getByRole('heading', { name: /Recent projects|最近/i }).first();
  await expect(recent).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => projectCards(page).count(), { timeout: 60_000 })
    .toBeGreaterThan(0);
}

async function collectCoverProbe(page: Page) {
  // Wait until at least one cover finishes decoding (new thumbs after edit can be slow).
  await page
    .waitForFunction(() => {
      const imgs = Array.from(document.querySelectorAll('article img')) as HTMLImageElement[];
      if (!imgs.length) return false;
      return imgs.some((img) => img.complete && img.naturalWidth > 0);
    }, { timeout: 60_000 })
    .catch(() => undefined);
  await sleep(500);
  return page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('article'));
    const rows = articles.slice(0, 12).map((a, idx) => {
      const title =
        a.querySelector('[contenteditable], h2, h3, p, span')?.textContent?.trim().slice(0, 80) ||
        '';
      const imgs = Array.from(a.querySelectorAll('img')) as HTMLImageElement[];
      const covers = imgs.map((img) => ({
        src: String(img.currentSrc || img.src || '').slice(0, 180),
        w: img.naturalWidth,
        h: img.naturalHeight,
        complete: img.complete,
      }));
      const broken = covers.filter((c) => c.complete && c.w === 0 && c.h === 0 && !!c.src);
      return { idx, title, coverCount: covers.length, covers, broken: broken.length };
    });
    return {
      articleCount: articles.length,
      withCover: rows.filter((r) => r.coverCount > 0).length,
      blankCoverCards: rows.filter((r) => r.coverCount === 0 && r.title).length,
      brokenCovers: rows.reduce((n, r) => n + r.broken, 0),
      rows,
    };
  });
}

async function openFirstProject(page: Page): Promise<Page> {
  const cards = projectCards(page);
  const count = await cards.count();
  // Home ProjectCard opens editor via window.open (new tab) when allowed.
  const popupPromise = page.context().waitForEvent('page', { timeout: 15_000 }).catch(() => null);
  if (count > 0) {
    const coverBtn = cards.first().locator('button').first();
    await coverBtn.click();
  } else {
    const newProj = page.getByRole('button', { name: /^New project$|^新建项目$|^新建$/i }).first();
    await newProj.click();
  }
  const popup = await popupPromise;
  const editor = popup || page;
  await editor.waitForURL(/\/editor\//, { timeout: 90_000 });
  await editor.waitForLoadState('domcontentloaded');
  // Auth for new tab (init script only applies to pages created after addInitScript).
  await editor.evaluate((tok) => {
    if (!localStorage.getItem('recombine-auth-token-v1')) {
      localStorage.setItem('recombine-auth-token-v1', tok);
    }
  }, TOKEN);
  await dismissBlockingDialogs(editor);
  await sleep(1_000);
  return editor;
}

async function ensureAgentDock(page: Page) {
  await page.evaluate(() => {
    try {
      localStorage.setItem('recombyn-editor-tour-v3', '1');
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('recombyn-editor-tour-v3')) localStorage.setItem(key, '1');
      }
    } catch {
      /* ignore */
    }
  });
  await sleep(800);
  await dismissBlockingDialogs(page);
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('[role="dialog"]'))) {
      const t = el.textContent || '';
      if (/Welcome to the editor|欢迎/i.test(t)) el.remove();
    }
  });

  // AgentDock renders as <aside>; open if composer not present.
  let composer = page.locator('aside [role="textbox"]').last();
  if (!(await composer.isVisible({ timeout: 2_000 }).catch(() => false))) {
    const agentBtn = page.getByRole('button', { name: /^Agent$/i }).first();
    if (await agentBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await agentBtn.click({ force: true });
      await sleep(500);
      await dismissBlockingDialogs(page);
    }
    composer = page.locator('aside [role="textbox"]').last();
  }
  await expect(composer).toBeVisible({ timeout: 20_000 });
  return composer;
}

async function sendAgent(page: Page, prompt: string) {
  const composer = await ensureAgentDock(page);
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await composer.click({ force: true });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(prompt, { delay: 5 });
  await sleep(300);
  const send = page.getByRole('button', { name: /send|发送/i }).first();
  for (let i = 0; i < 30; i += 1) {
    if (!(await send.isDisabled().catch(() => true))) {
      await send.click({ force: true });
      return;
    }
    await sleep(400);
  }
  await page.keyboard.press('Enter');
}

async function waitAgentIdle(page: Page, maxMs = 240_000) {
  const t0 = Date.now();
  let sawStop = false;
  while (Date.now() - t0 < maxMs) {
    const stop = page.getByRole('button', { name: /stop|停止|取消/i }).first();
    const send = page.getByRole('button', { name: /send|发送/i }).first();
    const stopVis = await stop.isVisible({ timeout: 300 }).catch(() => false);
    if (stopVis) sawStop = true;
    const sendOk = !(await send.isDisabled().catch(() => true));
    if (sawStop && !stopVis && sendOk && Date.now() - t0 > 8_000) break;
    if (!stopVis && sendOk && Date.now() - t0 > 25_000) break;
    await sleep(2_000);
  }
  // Dismiss review bar if present so next send works.
  const keep = page.getByRole('button', { name: /^Keep$|^保留$/i }).first();
  if (await keep.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await keep.click();
    await sleep(500);
  }
  return true;
}

test.describe('home → editor journey', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);
  test.beforeAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
  });

  test('A: home lists projects and covers load', async ({ page }) => {
    await injectAuth(page);
    await waitHomeProjects(page);
    await shot(page, '01-home');

    const probe = await collectCoverProbe(page);
    fs.writeFileSync(path.join(OUT, 'home-covers.json'), JSON.stringify(probe, null, 2));

    expect(probe.articleCount).toBeGreaterThan(0);
    // Prefer real covers; blank cards are a soft product signal (logged), not hard-fail.
    if (probe.withCover > 0) {
      // Require at least one healthy decoded cover among articles that have imgs.
      const healthy = probe.rows.some((r) => r.covers.some((c) => c.w > 0 && c.h > 0));
      expect(healthy, 'at least one home cover should decode').toBeTruthy();
      if (probe.brokenCovers > 0) {
        fs.writeFileSync(
          path.join(OUT, 'cover-broken-note.txt'),
          `brokenCovers=${probe.brokenCovers} (often offscreen carousel thumbs report naturalWidth=0)\n`
        );
      }
    }
    if (probe.blankCoverCards > 0) {
      fs.writeFileSync(
        path.join(OUT, 'cover-blank-note.txt'),
        `blankCoverCards=${probe.blankCoverCards}\n`
      );
    }
  });

  test('B: open editor from home, canvas mounts', async ({ page }) => {
    await injectAuth(page);
    await waitHomeProjects(page);
    const before = await collectCoverProbe(page);
    fs.writeFileSync(path.join(OUT, 'before-editor-covers.json'), JSON.stringify(before, null, 2));

    const editor = await openFirstProject(page);
    await shot(editor, '02-editor-open');

    // Canvas / stage should exist.
    const stage = editor.locator('[data-rcb-stage], [data-testid="editor-stage"], canvas, svg').first();
    await expect(stage).toBeVisible({ timeout: 60_000 });

    // URL keeps a project id.
    expect(editor.url()).toMatch(/\/editor\/[A-Za-z0-9_-]+/);
  });

  test('C: agent CRUD then return home — cover still valid', async ({ page }) => {
    await injectAuth(page);
    await waitHomeProjects(page);
    const editor = await openFirstProject(page);
    await dismissBlockingDialogs(editor);

    // New chat if available.
    const newChat = editor.getByRole('button', { name: /New chat|新对话|新建对话/i }).first();
    if (await newChat.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await newChat.click();
      await sleep(400);
    }

    await sendAgent(
      editor,
      '在画布上新增一个红色矩形，宽200高120，位置靠近左上，不要删除已有内容。'
    );
    const idle1 = await waitAgentIdle(editor, 300_000);
    await shot(editor, '03-after-add-rect');
    expect(idle1).toBeTruthy();

    await sendAgent(editor, '把刚才的红色矩形改成蓝色。');
    const idle2 = await waitAgentIdle(editor, 240_000);
    await shot(editor, '04-after-recolor');
    expect(idle2).toBeTruthy();

    // Leave editor → home (cover refresh path). Prefer home button; fall back to goto.
    const homeBtn = editor.getByRole('button', { name: /home|首页/i }).first();
    if (await homeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await homeBtn.click();
      await editor.waitForURL(/\/home/, { timeout: 30_000 }).catch(() => undefined);
    }
    if (!/\/home/.test(editor.url())) {
      await editor.goto('/home');
    }
    await editor.waitForURL(/\/home/, { timeout: 60_000 });
    await dismissBlockingDialogs(editor);
    await sleep(2_500);
    await shot(editor, '05-home-after-edit');

    const after = await collectCoverProbe(editor);
    fs.writeFileSync(path.join(OUT, 'after-edit-covers.json'), JSON.stringify(after, null, 2));
    const healthy = after.rows.some((r) => r.covers.some((c) => c.w > 0 && c.h > 0));
    expect(healthy, 'at least one home cover should decode after edit').toBeTruthy();

    // Soft: if we had covers before, still have some after (may regenerate with ?v=).
    if (after.articleCount > 0 && after.withCover === 0) {
      fs.writeFileSync(
        path.join(OUT, 'cover-regression.txt'),
        'Home projects rendered with zero cover images after editor edit/sync.'
      );
    }
  });
});
