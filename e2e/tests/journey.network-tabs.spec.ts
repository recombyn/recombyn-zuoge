/**
 * Home ↔ editor smoke + network audit: nav tabs, inspiration tabs, request counts / dupes.
 *
 * Requires: web on E2E_BASE_URL, API, token in ../.tmp-token.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page, type Request } from '@playwright/test';
import { E2E_TOKEN_SKIP_REASON, resolveE2EToken } from './e2eAuth';

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, '.tmp-e2e-network');
const TOKEN = resolveE2EToken(ROOT);

test.setTimeout(8 * 60_000);

type NetHit = {
  phase: string;
  method: string;
  url: string;
  path: string;
  status?: number;
  ms?: number;
  t: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function apiPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

function isApiRequest(url: string): boolean {
  return /\/api\/v1\//i.test(url);
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
      await sleep(250);
      continue;
    }
    const dialog = page.locator('[role="dialog"]').first();
    if (!(await dialog.isVisible().catch(() => false))) break;
    await page.keyboard.press('Escape');
    await sleep(250);
  }
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('[role="dialog"]'))) {
      const t = el.textContent || '';
      if (/Welcome to the editor|欢迎/i.test(t)) el.remove();
    }
  });
}

function attachNetworkProbe(page: Page, hits: NetHit[], phaseRef: { current: string }) {
  const started = new Map<Request, number>();
  page.on('request', (req) => {
    if (!isApiRequest(req.url())) return;
    started.set(req, Date.now());
  });
  page.on('response', (res) => {
    const req = res.request();
    if (!isApiRequest(req.url())) return;
    const t0 = started.get(req) || Date.now();
    hits.push({
      phase: phaseRef.current,
      method: req.method(),
      url: req.url(),
      path: apiPath(req.url()),
      status: res.status(),
      ms: Date.now() - t0,
      t: Date.now(),
    });
    started.delete(req);
  });
  page.on('requestfailed', (req) => {
    if (!isApiRequest(req.url())) return;
    const t0 = started.get(req) || Date.now();
    hits.push({
      phase: phaseRef.current,
      method: req.method(),
      url: req.url(),
      path: apiPath(req.url()),
      status: 0,
      ms: Date.now() - t0,
      t: Date.now(),
    });
    started.delete(req);
  });
}

function summarize(hits: NetHit[]) {
  const byPath = new Map<string, number>();
  const byPhase = new Map<string, number>();
  const byMethodPath = new Map<string, number>();
  for (const h of hits) {
    byPath.set(h.path, (byPath.get(h.path) || 0) + 1);
    byPhase.set(h.phase, (byPhase.get(h.phase) || 0) + 1);
    const key = `${h.method} ${h.path}`;
    byMethodPath.set(key, (byMethodPath.get(key) || 0) + 1);
  }
  const duplicates = [...byMethodPath.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count }));
  const listMy = hits.filter((h) => /\/projects(\?|$)/i.test(h.path) && h.method === 'GET');
  const plaza = hits.filter((h) => /\/plaza\//i.test(h.path));
  const thumbs = hits.filter((h) => /\/uploads\/files\//i.test(h.path));
  return {
    totalApi: hits.length,
    byPhase: Object.fromEntries(byPhase),
    topPaths: [...byPath.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
    duplicates: duplicates.slice(0, 30),
    projectsListGets: listMy.length,
    plazaCalls: plaza.length,
    thumbFetches: thumbs.length,
    avgMs:
      hits.length === 0
        ? 0
        : Math.round(hits.reduce((s, h) => s + (h.ms || 0), 0) / hits.length),
  };
}

test.describe('home/editor network + tabs', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);
  test('nav tabs, inspiration tabs, editor open — capture APIs', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    const hits: NetHit[] = [];
    const phaseRef = { current: 'boot' };
    attachNetworkProbe(page, hits, phaseRef);
    await injectAuth(page);

    // --- Home cold load ---
    phaseRef.current = 'home_cold';
    const tHome0 = Date.now();
    await page.goto('/home');
    await page.waitForURL(/\/home/, { timeout: 60_000 });
    await dismissBlockingDialogs(page);
    await expect(page.getByRole('heading', { name: /Recent projects|最近/i }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect
      .poll(async () => page.locator('article').count(), { timeout: 60_000 })
      .toBeGreaterThan(0);
    await sleep(2_000);
    const homeColdMs = Date.now() - tHome0;
    await page.screenshot({ path: path.join(OUT, '01-home-cold.png') });

    // --- Inspiration category tabs ---
    const inspTabs = [
      { name: /^All$|^全部$/i, phase: 'insp_all' },
      { name: /^Poster$|^海报$/i, phase: 'insp_poster' },
      { name: /^Mobile app$|^移动应用$|^Mobile$/i, phase: 'insp_mobile' },
      { name: /^Images$|^图片$/i, phase: 'insp_images' },
      { name: /^Video$|^视频$/i, phase: 'insp_video' },
    ];
    for (const tab of inspTabs) {
      phaseRef.current = tab.phase;
      const btn = page.getByRole('tab', { name: tab.name }).first();
      if (!(await btn.isVisible({ timeout: 3_000 }).catch(() => false))) continue;
      const before = hits.length;
      const t0 = Date.now();
      await btn.click();
      await sleep(1_200);
      const added = hits.slice(before);
      fs.writeFileSync(
        path.join(OUT, `${tab.phase}.json`),
        JSON.stringify(
          {
            ms: Date.now() - t0,
            added: added.length,
            paths: added.map((h) => `${h.method} ${h.path}`),
          },
          null,
          2
        )
      );
    }
    await page.screenshot({ path: path.join(OUT, '02-insp-tabs.png') });

    // --- Side nav: Projects / Skills / Me / Home ---
    async function clickRail(label: RegExp, phase: string) {
      phaseRef.current = phase;
      const before = hits.length;
      const t0 = Date.now();
      const btn = page.getByRole('button', { name: label }).first();
      await expect(btn).toBeVisible({ timeout: 15_000 });
      await btn.click();
      await sleep(2_000);
      await dismissBlockingDialogs(page);
      return { ms: Date.now() - t0, added: hits.slice(before) };
    }

    const projectsNav = await clickRail(/^Projects$|^项目$|^我的项目$/i, 'nav_projects');
    await expect(page.getByRole('heading', { name: /Projects|项目|我的/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.screenshot({ path: path.join(OUT, '03-nav-projects.png') });

    const skillsNav = await clickRail(/^Skills$|^技能$/i, 'nav_skills');
    await sleep(1_000);
    await page.screenshot({ path: path.join(OUT, '04-nav-skills.png') });

    const meNav = await clickRail(/^Me$|^我的$|^Account$/i, 'nav_me');
    await sleep(1_000);
    await page.screenshot({ path: path.join(OUT, '05-nav-me.png') });

    const homeNav = await clickRail(/^Home$|^首页$/i, 'nav_home');
    await expect(page.getByRole('heading', { name: /Recent projects|最近/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.screenshot({ path: path.join(OUT, '06-nav-home.png') });

    // Re-click Home while already on Home — should not needlessly refetch if cache warm
    // (product currently refreshes; record it).
    phaseRef.current = 'nav_home_reclick';
    const beforeRe = hits.length;
    await page.getByRole('button', { name: /^Home$|^首页$/i }).first().click();
    await sleep(2_000);
    const homeReclick = hits.slice(beforeRe);

    // --- Open editor (new tab) ---
    phaseRef.current = 'open_editor';
    const popupPromise = page.context().waitForEvent('page', { timeout: 15_000 }).catch(() => null);
    const cover = page.locator('article').filter({ hasNotText: /^loading$/i }).first().locator('button').first();
    await cover.click();
    const popup = await popupPromise;
    const editor = popup || page;
    attachNetworkProbe(editor, hits, phaseRef);
    await editor.waitForURL(/\/editor\//, { timeout: 90_000 });
    await editor.evaluate((tok) => {
      if (!localStorage.getItem('recombine-auth-token-v1')) {
        localStorage.setItem('recombine-auth-token-v1', tok);
      }
      localStorage.setItem('recombyn-editor-tour-v3', '1');
      localStorage.setItem('recombyn-editor-tour-v3:user_super_admin', '1');
    }, TOKEN);
    await dismissBlockingDialogs(editor);
    await expect(
      editor.locator('[data-rcb-stage], aside [role="textbox"], canvas, svg').first()
    ).toBeVisible({ timeout: 60_000 });
    await sleep(3_000);
    await editor.screenshot({ path: path.join(OUT, '07-editor.png') });

    // Light editor chrome: ensure Agent dock / Export visible (no long agent run).
    phaseRef.current = 'editor_chrome';
    const exportBtn = editor.getByRole('button', { name: /Export|导出/i }).first();
    await expect(exportBtn).toBeVisible({ timeout: 20_000 });
    const agentComposer = editor.locator('aside [role="textbox"]').last();
    if (!(await agentComposer.isVisible({ timeout: 3_000 }).catch(() => false))) {
      const agentBtn = editor.getByRole('button', { name: /^Agent$/i }).first();
      if (await agentBtn.isVisible().catch(() => false)) await agentBtn.click({ force: true });
    }
    await sleep(1_500);

    // Back home via button (flush path) then measure list refresh.
    phaseRef.current = 'editor_to_home';
    const homeBtn = editor.getByRole('button', { name: /home|首页/i }).first();
    if (await homeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await homeBtn.click();
      await editor.waitForURL(/\/home/, { timeout: 30_000 }).catch(() => undefined);
    }
    if (!/\/home/.test(editor.url())) await editor.goto('/home');
    await editor.waitForURL(/\/home/, { timeout: 60_000 });
    await sleep(2_500);
    await editor.screenshot({ path: path.join(OUT, '08-home-after-editor.png') });

    const summary = summarize(hits);
    const report = {
      ok: true,
      homeColdMs,
      nav: {
        projectsMs: projectsNav.ms,
        projectsApis: projectsNav.added.length,
        skillsMs: skillsNav.ms,
        skillsApis: skillsNav.added.length,
        meMs: meNav.ms,
        meApis: meNav.added.length,
        homeMs: homeNav.ms,
        homeApis: homeNav.added.length,
        homeReclickApis: homeReclick.length,
        homeReclickPaths: homeReclick.map((h) => `${h.method} ${h.path}`),
      },
      summary,
      hits,
    };
    fs.writeFileSync(path.join(OUT, 'network-report.json'), JSON.stringify(report, null, 2));

    // Soft assertions — journeys must complete; network is diagnostic.
    expect(homeColdMs).toBeLessThan(60_000);
    expect(summary.totalApi).toBeGreaterThan(0);
    // Flag heavy duplicate list fetches on cold home (query + effect).
    const coldList = hits.filter(
      (h) => h.phase === 'home_cold' && h.method === 'GET' && /\/projects(\?|$)/i.test(h.path)
    );
    fs.writeFileSync(
      path.join(OUT, 'projects-list-cold.json'),
      JSON.stringify({ count: coldList.length, paths: coldList.map((h) => h.path) }, null, 2)
    );
  });
});
