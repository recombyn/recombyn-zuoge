/**
 * Browser E2E: design agent with reference images.
 * Case A — mobile home from 转转-style ref.
 * Case B — long-scroll detail; focus the middle stall-map region (not full page chrome).
 *
 * Requires API + web (reuseExistingServer). Token: E2E_TOKEN or ../.tmp-token.txt
 * Prefer E2E_BASE_URL=http://localhost:3000 (IPv6 listen) over 127.0.0.1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { E2E_TOKEN_SKIP_REASON, resolveE2EToken } from './e2eAuth';

const ROOT = path.resolve(__dirname, '../..');
const FIX = path.join(__dirname, '../fixtures/refs');
const OUT = path.join(ROOT, '.tmp-agent-ref-ui');
const TOKEN = resolveE2EToken(ROOT);

const HOME_REF = path.join(FIX, 'zhuanzhuan-home.png');
const DETAIL_REF = path.join(FIX, 'summer-detail-middle.png');

const PROMPT_HOME =
  '参考附图，做一张 390x844 手机 App 首页 UI（二手电商风格）。' +
  '还原：顶栏搜索、分类入口、大促横幅区、双排品类、回收入口、底栏 Tab。' +
  '可编辑矢量组件；图标用矢量字形，不要 emoji；不要整屏位图糊弄。';

const PROMPT_DETAIL =
  '参考附图做详情/活动长图里的「中间区域」：摊位导览地图板块（打卡必存超全摊位导览 + 等距摊位示意），' +
  '不是整页从头到尾复制。画板约 750 宽；中间导览区要完整可读；矢量为主，不要 emoji 当图标。';

test.setTimeout(12 * 60_000);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function injectAuth(page: Page) {
  await page.addInitScript((tok) => {
    localStorage.setItem('recombine-auth-token-v1', tok);
  }, TOKEN);
}

async function openEditor(page: Page) {
  const known = process.env.E2E_EDITOR_PATH || '/editor/aZ0FRsXFkjbQtnPFmohSZ';
  await page.goto(known);
  await page.waitForURL(/\/editor\//, { timeout: 60_000 });
  await page.waitForLoadState('domcontentloaded');
  await sleep(800);
}

async function ensureAgentDock(page: Page) {
  const composer = page.getByRole('textbox', {
    name: /@Search for image, model, or project|Search|Ask|Design/i,
  });
  if (await composer.isVisible({ timeout: 3_000 }).catch(() => false)) return composer;
  const agentBtn = page.getByRole('button', { name: /^Agent$/i }).first();
  if (await agentBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await agentBtn.click();
  }
  return page.getByRole('textbox', {
    name: /@Search for image, model, or project|Search|Ask|Design/i,
  });
}

async function newChat(page: Page) {
  const btn = page.getByRole('button', { name: /New chat/i }).first();
  if (await btn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await btn.click();
    await sleep(500);
  }
}

async function attachRef(page: Page, filePath: string) {
  const input = page.locator('input[type="file"][accept*="image"]').last();
  await expect(input).toBeAttached({ timeout: 15_000 });
  await input.setInputFiles(filePath);
  await sleep(1_500);
}

async function sendPrompt(page: Page, prompt: string) {
  const composer = await ensureAgentDock(page);
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await composer.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(prompt, { delay: 4 });
  await sleep(400);
  const send = page.getByRole('button', { name: /send|发送/i }).first();
  for (let i = 0; i < 40; i += 1) {
    const disabled = await send.isDisabled().catch(() => true);
    if (!disabled) {
      await send.click();
      return;
    }
    await sleep(400);
  }
  await page.keyboard.press('Enter');
}

async function waitRunSettle(page: Page, outName: string, maxMs = 480_000) {
  const t0 = Date.now();
  let sawOps = false;
  let sawShimmer = false;
  let sawStop = false;
  while (Date.now() - t0 < maxMs) {
    const shimmer = page.locator('[data-artboard-process-shimmer]');
    if (await shimmer.count()) sawShimmer = true;
    const send = page.getByRole('button', { name: /send|发送/i }).first();
    const stop = page.getByRole('button', { name: /stop|停止|取消/i }).first();
    const stopVisible = await stop.isVisible({ timeout: 400 }).catch(() => false);
    if (stopVisible) sawStop = true;
    const sendEnabled = !(await send.isDisabled().catch(() => true));
    const nodes = page.locator('[data-rcb-shape-layer], [data-node-id]');
    if ((await nodes.count()) > 2) sawOps = true;
    // Settle: had a run (stop or shimmer), then send re-enabled.
    if (sawStop && !stopVisible && sendEnabled && Date.now() - t0 > 20_000) break;
    if (!stopVisible && sendEnabled && sawOps && Date.now() - t0 > 90_000) break;
    if ((Date.now() - t0) % 60_000 < 4_000) {
      await page.screenshot({
        path: path.join(OUT, `${outName}-progress.png`),
        fullPage: false,
      });
    }
    await sleep(3_000);
  }
  await page.screenshot({ path: path.join(OUT, `${outName}-final.png`), fullPage: false });
  return { sawOps, sawShimmer, sawStop, ms: Date.now() - t0 };
}

test.describe('agent ref UI browser E2E', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);
  test.beforeAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
    expect(fs.existsSync(HOME_REF)).toBeTruthy();
    expect(fs.existsSync(DETAIL_REF)).toBeTruthy();
  });

  test('A: mobile home from ref', async ({ page }) => {
    await injectAuth(page);
    await openEditor(page);
    await ensureAgentDock(page);
    await newChat(page);
    await attachRef(page, HOME_REF);
    await sendPrompt(page, PROMPT_HOME);
    const result = await waitRunSettle(page, 'home');
    fs.writeFileSync(path.join(OUT, 'home-result.json'), JSON.stringify(result, null, 2));
    expect(result.sawStop || result.sawShimmer || result.sawOps).toBeTruthy();
  });

  test('B: detail middle stall map from ref', async ({ page }) => {
    await injectAuth(page);
    await openEditor(page);
    await ensureAgentDock(page);
    await newChat(page);
    await attachRef(page, DETAIL_REF);
    await sendPrompt(page, PROMPT_DETAIL);
    const result = await waitRunSettle(page, 'detail-middle');
    fs.writeFileSync(
      path.join(OUT, 'detail-middle-result.json'),
      JSON.stringify(result, null, 2)
    );
    expect(result.sawStop || result.sawShimmer || result.sawOps).toBeTruthy();
  });
});
