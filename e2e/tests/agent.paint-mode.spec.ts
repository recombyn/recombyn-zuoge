/**
 * Browser E2E + light stress: Agent settings「板式生成」→ paint_mode=img_layers.
 *
 * A) Settings → Agent: toggle board paint + localStorage
 * B) Intercept /design/run body includes paint_mode (prefs via localStorage)
 * D) UI stress on settings page
 * C) Optional full gen+split (E2E_IMG_LAYERS_FULL=1)
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { E2E_TOKEN_SKIP_REASON, resolveE2EToken } from './e2eAuth';

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, '.tmp-agent-paint-mode');
const TOKEN = resolveE2EToken(ROOT);
const FULL = String(process.env.E2E_IMG_LAYERS_FULL || '').trim() === '1';

test.setTimeout(FULL ? 12 * 60_000 : 3 * 60_000);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function injectAuth(page: Page, paintMode: 'ops' | 'img_layers' = 'ops') {
  await page.addInitScript(
    ([tok, mode]) => {
      localStorage.setItem('recombine-auth-token-v1', tok);
      localStorage.setItem('resume.agentPaintMode.v1', mode);
      localStorage.setItem('recombyn-editor-tour-v3', '1');
      localStorage.setItem('recombyn-editor-tour-v3:user_super_admin', '1');
    },
    [TOKEN, paintMode]
  );
}

async function dismissTour(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem('recombyn-editor-tour-v3', '1');
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('recombyn-editor-tour-v3')) localStorage.setItem(key, '1');
    }
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const t = (el.textContent || '').slice(0, 80);
      if (/Welcome to the editor|欢迎/i.test(t)) (el as HTMLElement).style.display = 'none';
    }
  });
  const skip = page.getByRole('button', { name: /^Skip$|^跳过$/i });
  if (await skip.first().isVisible({ timeout: 1_500 }).catch(() => false)) {
    await skip.first().click({ force: true });
    await sleep(300);
  }
}

async function seedAuthSession(page: Page) {
  const api = (process.env.E2E_API || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const me = await page.request.get(`${api}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    timeout: 45_000,
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

async function openEditor(page: Page) {
  const known = process.env.E2E_EDITOR_PATH || '/editor/aZ0FRsXFkjbQtnPFmohSZ';
  await seedAuthSession(page);
  await page.goto(known, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await expect(page).toHaveURL(/\/editor\//, { timeout: 45_000 });
  await dismissTour(page);
  await sleep(500);
}

/** Open Account → Agent (full AgentRoutePrefsEditor with board paint control). */
async function openAgentSettings(page: Page) {
  await page.goto('/account?tab=agent', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await expect(page).toHaveURL(/\/account/, { timeout: 20_000 });
  await dismissTour(page);
  const paint = page.getByRole('tablist', { name: /板式生成|Board paint/i });
  await expect(paint).toBeVisible({ timeout: 20_000 });
  return paint;
}

async function setPaintModeInSettings(page: Page, mode: 'ops' | 'img_layers') {
  const tabs = await openAgentSettings(page);
  const label = mode === 'img_layers' ? /生图拆层|Image layers/i : /工具操作|Canvas ops/i;
  const tab = tabs.getByRole('tab', { name: label });
  if (await tab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await tab.click({ force: true });
  } else {
    await page.getByText(label).first().click({ force: true });
  }
  await sleep(200);
  const stored = await page.evaluate(() => localStorage.getItem('resume.agentPaintMode.v1'));
  expect(stored).toBe(mode);
}

async function ensureAgentDock(page: Page) {
  await dismissTour(page);
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('[role="dialog"]'))) {
      const t = el.textContent || '';
      if (/Welcome to the editor|欢迎/i.test(t)) el.remove();
    }
  });

  // Placeholder is a sibling overlay — textbox itself often has no accessible name.
  let composer = page.locator('aside [role="textbox"], [data-agent-composer][role="textbox"]').last();
  if (!(await composer.isVisible({ timeout: 2_000 }).catch(() => false))) {
    const agentBtn = page.getByRole('button', { name: /^Agent$/i }).first();
    if (await agentBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await agentBtn.click({ force: true });
      await sleep(400);
      await dismissTour(page);
    }
    composer = page.locator('aside [role="textbox"], [data-agent-composer][role="textbox"]').last();
  }
  await expect(composer).toBeVisible({ timeout: 20_000 });
  return composer;
}

async function ensureAgentInteractionMode(page: Page) {
  const modeBtn = page.locator('aside button[aria-label]').filter({
    has: page.locator('svg'),
  });
  // Mode picker is the first toolbar icon whose label is Agent/Ask/Image/Video.
  const picker = page
    .locator('aside')
    .getByRole('button', { name: /^(Agent|Ask|Image|Video|智能体|提问|图片|视频)$/i })
    .first();
  if (!(await picker.isVisible({ timeout: 5_000 }).catch(() => false))) return;
  const label = ((await picker.getAttribute('aria-label')) || '').trim();
  if (/^Agent$|^智能体$/i.test(label)) return;
  await picker.click({ force: true });
  await sleep(200);
  const agentItem = page
    .getByRole('button', { name: /^Agent$|^智能体$/i })
    .or(page.getByText(/^Agent$|^智能体$/i))
    .last();
  if (await agentItem.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await agentItem.click({ force: true });
    await sleep(300);
  }
  void modeBtn;
}

async function sendShortPrompt(page: Page, prompt: string) {
  const composer = await ensureAgentDock(page);
  await ensureAgentInteractionMode(page);
  // Models catalog must resolve before send() will hit /design/run.
  await page
    .waitForResponse(
      (r) => r.url().includes('/chat/models') && r.ok(),
      { timeout: 60_000 }
    )
    .catch(() => undefined);
  await composer.click({ force: true });
  await sleep(200);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await composer.pressSequentially(prompt, { delay: 8 });
  await expect
    .poll(async () => ((await composer.textContent()) || '').trim().length, {
      timeout: 10_000,
    })
    .toBeGreaterThan(5);
  const send = page.locator('aside').getByRole('button', { name: /send|发送/i }).first();
  await expect(send).toBeEnabled({ timeout: 30_000 });
  await send.click({ force: true });
}

test.describe('agent paint_mode browser E2E', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);

  test.beforeAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
  });

  test('A: Agent settings toggles paint_mode into localStorage', async ({ page }) => {
    await injectAuth(page);
    await seedAuthSession(page);
    await setPaintModeInSettings(page, 'img_layers');
    await setPaintModeInSettings(page, 'ops');
    await setPaintModeInSettings(page, 'img_layers');
    await page.screenshot({ path: path.join(OUT, 'a-paint-mode-settings.png'), fullPage: false });
  });

  test('B: /design/run carries paint_mode=img_layers', async ({ page }) => {
    await injectAuth(page, 'img_layers');
    await openEditor(page);
    await ensureAgentDock(page);

    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST') posts.push(req.url());
    });

    const bodyPromise = page
      .waitForRequest(
        (req) => req.method() === 'POST' && /\/design\/run(?:\?|$)/.test(req.url()),
        { timeout: 90_000 }
      )
      .then(async (req) => {
        try {
          return req.postDataJSON() as Record<string, unknown>;
        } catch {
          const raw = req.postData() || '';
          return JSON.parse(raw) as Record<string, unknown>;
        }
      });

    await sendShortPrompt(page, '做一张极简海报：大标题 Hello，白底黑字，390x844');
    let body: Record<string, unknown>;
    try {
      body = await bodyPromise;
    } catch (err) {
      throw new Error(
        `design/run not seen. recent POSTs=${JSON.stringify(posts.slice(-12))}. cause=${err}`
      );
    }
    fs.writeFileSync(path.join(OUT, 'b-design-run-body.json'), JSON.stringify(body, null, 2));
    expect(body.paint_mode).toBe('img_layers');
    expect(String(body.prompt || '')).toMatch(/Hello|海报/);

    const stop = page.getByRole('button', { name: /stop|停止|取消/i }).first();
    if (await stop.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await stop.click({ force: true });
    }
    await page.screenshot({ path: path.join(OUT, 'b-request-asserted.png'), fullPage: false });
  });

  test('D: UI stress — settings paint mode 8×', async ({ page }) => {
    await injectAuth(page);
    await seedAuthSession(page);
    for (let i = 0; i < 8; i += 1) {
      const mode = i % 2 === 0 ? 'img_layers' : 'ops';
      await setPaintModeInSettings(page, mode);
    }
    const stored = await page.evaluate(() => localStorage.getItem('resume.agentPaintMode.v1'));
    expect(stored).toBe('ops');
    await page.screenshot({ path: path.join(OUT, 'd-ui-stress.png'), fullPage: false });
  });

  test('C: full img_layers run (opt-in)', async ({ page }) => {
    test.skip(!FULL, 'Set E2E_IMG_LAYERS_FULL=1 to run full gen+split');
    await injectAuth(page, 'img_layers');
    await openEditor(page);
    await sendShortPrompt(
      page,
      '生成一张清爽产品海报：主标题「Recombyn」，副标题「懂你的设计 Agent」，390x844，高对比文字'
    );

    const t0 = Date.now();
    let sawStop = false;
    let sawNodes = false;
    let sawToken = false;
    while (Date.now() - t0 < 10 * 60_000) {
      const stop = page.getByRole('button', { name: /stop|停止|取消/i }).first();
      if (await stop.isVisible({ timeout: 400 }).catch(() => false)) sawStop = true;
      const send = page.getByRole('button', { name: /send|发送/i }).first();
      const sendOk = !(await send.isDisabled().catch(() => true));
      const nodes = page.locator('[data-rcb-shape-layer], [data-node-id]');
      if ((await nodes.count()) > 2) sawNodes = true;
      const chat = page.locator('aside').filter({ hasText: /生图拆层|拆出|整板/ });
      if (await chat.first().isVisible({ timeout: 200 }).catch(() => false)) sawToken = true;
      if (sawStop && sendOk && Date.now() - t0 > 15_000) break;
      if (sawNodes && sendOk && Date.now() - t0 > 30_000) break;
      await sleep(2_500);
    }
    const result = { sawStop, sawNodes, sawToken, ms: Date.now() - t0 };
    fs.writeFileSync(path.join(OUT, 'c-full-result.json'), JSON.stringify(result, null, 2));
    await page.screenshot({ path: path.join(OUT, 'c-full-final.png'), fullPage: false });
    expect(result.sawStop || result.sawNodes || result.sawToken).toBeTruthy();
  });
});
