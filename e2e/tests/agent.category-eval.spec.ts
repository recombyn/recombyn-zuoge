/**
 * Browser eval: category craft flows (poster / banner / …).
 * Prompts from apps/api/seeds/design_agent_eval_suite.json.
 *
 * Stall rule (suite note): >150s with no canvas growth → Stop and retry once.
 *
 * Requires: web, API, token. Opt-in: E2E_EVAL=1
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { E2E_TOKEN_SKIP_REASON, resolveE2EToken } from './e2eAuth';

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, '.tmp-e2e-category-eval');
const SUITE = path.join(ROOT, 'apps/api/seeds/design_agent_eval_suite.json');
const TOKEN = resolveE2EToken(ROOT);
/** Opt-in only — do not run this long suite on default CI. */
const EVAL_ENABLED = (process.env.E2E_EVAL || '').trim() === '1';
const EVAL_SKIP_REASON = EVAL_ENABLED
  ? E2E_TOKEN_SKIP_REASON
  : 'Set E2E_EVAL=1 (and a token) to run category eval';

/** Default: poster-heavy + UI surfaces. Override with E2E_EVAL_CASES=poster,banner,mobile_ui */
const DEFAULT_CASE_IDS = [
  'poster',
  'banner',
  'mobile_ui',
  'dashboard',
  'landing',
  'ecommerce',
];

type SuiteCase = { id: string; prompt: string; skill_expect?: string[] };

type CaseResult = {
  id: string;
  ok: boolean;
  ms: number;
  sawStop: boolean;
  sawShimmer: boolean;
  sawOps: boolean;
  nodeDelta: number;
  retried: boolean;
  error: string | null;
};

test.setTimeout(90 * 60_000);
test.describe.configure({ mode: 'serial' });

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function selectedCases(): SuiteCase[] {
  const suite = JSON.parse(fs.readFileSync(SUITE, 'utf8')) as { cases: SuiteCase[] };
  const raw = (process.env.E2E_EVAL_CASES || '').trim();
  const ids = raw
    ? raw.split(/[,;\s]+/).filter(Boolean)
    : DEFAULT_CASE_IDS;
  const want = new Set(ids);
  const picked = suite.cases.filter((c) => want.has(c.id));
  if (!picked.length) {
    throw new Error(`No eval cases matched: ${[...want].join(',')}`);
  }
  return picked;
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
  for (let i = 0; i < 8; i += 1) {
    const skip = page.getByRole('button', { name: /^Skip$|^跳过$/i });
    if ((await skip.count()) > 0) {
      await skip.last().click({ force: true }).catch(() => undefined);
      await sleep(300);
      continue;
    }
    const dialog = page.locator('[role="dialog"]').first();
    if (!(await dialog.isVisible().catch(() => false))) break;
    const close = dialog
      .getByRole('button', { name: /close|关闭|取消|got it|知道了|确认|ok|skip|跳过/i })
      .first();
    if (await close.isVisible({ timeout: 400 }).catch(() => false)) {
      await close.click({ force: true }).catch(() => undefined);
      await sleep(250);
      continue;
    }
    await page.keyboard.press('Escape');
    await sleep(250);
  }
}

async function openEditor(page: Page) {
  const known = (process.env.E2E_EDITOR_PATH || '/editor/aZ0FRsXFkjbQtnPFmohSZ').trim();
  try {
    await page.goto(known, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await page.waitForURL(/\/editor\//, { timeout: 15_000 });
    await dismissBlockingDialogs(page);
    await sleep(600);
    // Composer must appear — otherwise fall through to New project.
    const composer = page.locator('aside [role="textbox"]').last();
    if (await composer.isVisible({ timeout: 8_000 }).catch(() => false)) return;
  } catch {
    /* fall through */
  }

  await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForURL(/\/home/, { timeout: 30_000 });
  await dismissBlockingDialogs(page);
  const popupPromise = page.context().waitForEvent('page', { timeout: 20_000 }).catch(() => null);
  const newProj = page.getByRole('button', { name: /^New project$|^新建项目$|^新建$/i }).first();
  if (await newProj.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await newProj.click({ force: true });
  } else {
    const card = page
      .locator('article')
      .filter({ hasNot: page.getByRole('button', { name: /^New project$|^新建项目$/i }) })
      .first();
    await card.locator('button').first().click({ force: true });
  }
  const popup = await popupPromise;
  if (popup) {
    await popup.waitForURL(/\/editor\//, { timeout: 90_000 });
    await popup.evaluate((tok) => {
      localStorage.setItem('recombine-auth-token-v1', tok);
      localStorage.setItem('recombyn-editor-tour-v3', '1');
    }, TOKEN);
    await dismissBlockingDialogs(popup);
    await page.goto(popup.url(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  } else {
    await page.waitForURL(/\/editor\//, { timeout: 90_000 });
  }
  await dismissBlockingDialogs(page);
  await sleep(800);
}

async function ensureAgentDock(page: Page) {
  await dismissBlockingDialogs(page);
  let composer = page.locator('aside [role="textbox"]').last();
  if (!(await composer.isVisible({ timeout: 2_000 }).catch(() => false))) {
    const agentBtn = page.getByRole('button', { name: /^Agent$/i }).first();
    if (await agentBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await agentBtn.click({ force: true });
      await sleep(500);
    }
    composer = page.locator('aside [role="textbox"]').last();
  }
  await expect(composer).toBeVisible({ timeout: 30_000 });
  return composer;
}

async function newChat(page: Page) {
  const btn = page.getByRole('button', { name: /New chat|新对话|新建对话/i }).first();
  if (await btn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await btn.click();
    await sleep(600);
  }
}

async function countCanvasNodes(page: Page): Promise<number> {
  return page.locator('[data-rcb-shape-layer], [data-node-id]').count();
}

async function sendPrompt(page: Page, prompt: string) {
  const composer = await ensureAgentDock(page);
  await composer.click({ timeout: 8_000 });
  // fill is faster/more reliable than per-char type for long eval prompts.
  await composer.fill(prompt);
  await sleep(400);
  const send = page.getByRole('button', { name: /send|发送/i }).first();
  for (let i = 0; i < 30; i += 1) {
    const visible = await send.isVisible({ timeout: 500 }).catch(() => false);
    if (!visible) break;
    const disabled = await Promise.race([
      send.isDisabled().catch(() => true),
      sleep(2_000).then(() => true),
    ]);
    if (!disabled) {
      await send.click({ timeout: 5_000 });
      return;
    }
    await sleep(400);
  }
  await page.keyboard.press('Enter');
}

async function runOneCase(page: Page, c: SuiteCase): Promise<CaseResult> {
  const t0 = Date.now();
  let retried = false;
  const mark = (step: string) => {
    fs.writeFileSync(
      path.join(OUT, `${c.id}-step.json`),
      JSON.stringify({ step, t: Date.now() - t0, at: new Date().toISOString() }, null, 2)
    );
  };
  try {
    mark('ensureAgentDock');
    await ensureAgentDock(page);
    mark('newChat');
    await newChat(page);
    await dismissBlockingDialogs(page);
    const nodesBefore = await countCanvasNodes(page);
    mark('sendPrompt');
    await sendPrompt(page, c.prompt);
    mark('waitRunSettle');
    let settled = await waitRunSettle(page, c.id, { nodesBefore });

    if (settled.stalledNoCanvas) {
      retried = true;
      mark('retry_after_stall');
      await clickStop(page);
      await sleep(1_500);
      await newChat(page);
      const nodesBefore2 = await countCanvasNodes(page);
      await sendPrompt(page, c.prompt);
      settled = await waitRunSettle(page, `${c.id}-retry`, { nodesBefore: nodesBefore2 });
    }

    const ok = settled.sawStop || settled.sawShimmer || settled.sawOps || settled.nodeDelta > 0;
    mark(ok ? 'done_ok' : 'done_fail');
    return {
      id: c.id,
      ok,
      ms: Date.now() - t0,
      sawStop: settled.sawStop,
      sawShimmer: settled.sawShimmer,
      sawOps: settled.sawOps,
      nodeDelta: settled.nodeDelta,
      retried,
      error: ok ? null : 'no run activity / no canvas growth',
    };
  } catch (err) {
    mark('error');
    await page.screenshot({ path: path.join(OUT, `${c.id}-error.png`), fullPage: false }).catch(
      () => undefined
    );
    return {
      id: c.id,
      ok: false,
      ms: Date.now() - t0,
      sawStop: false,
      sawShimmer: false,
      sawOps: false,
      nodeDelta: 0,
      retried,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function clickStop(page: Page) {
  const stop = page.getByRole('button', { name: /stop|停止|取消/i }).first();
  if (await stop.isVisible({ timeout: 800 }).catch(() => false)) {
    await stop.click({ force: true }).catch(() => undefined);
    await sleep(1_000);
  }
}

/** Accept paused scene_feedback so the run can finish (Keep / 保留). */
async function acceptKeepIfPresent(page: Page): Promise<boolean> {
  const keep = page.getByRole('button', { name: /^Keep$|^保留$/i }).first();
  if (!(await keep.isVisible({ timeout: 400 }).catch(() => false))) return false;
  await keep.click({ force: true }).catch(() => undefined);
  await sleep(800);
  return true;
}

async function waitRunSettle(
  page: Page,
  outName: string,
  opts: { nodesBefore: number; maxMs?: number }
): Promise<Omit<CaseResult, 'id' | 'ok' | 'error' | 'retried'> & { stalledNoCanvas: boolean }> {
  const maxMs = opts.maxMs ?? 420_000;
  const t0 = Date.now();
  let sawOps = false;
  let sawShimmer = false;
  let sawStop = false;
  let kept = false;
  let peakNodes = opts.nodesBefore;
  let lastGrowthAt = Date.now();
  let stalledNoCanvas = false;

  let lastShotAt = 0;
  // Immediate heartbeat so we can detect hangs outside the settle loop.
  fs.writeFileSync(
    path.join(OUT, `${outName}-heartbeat.json`),
    JSON.stringify({ t: 0, phase: 'enter_settle' }, null, 2)
  );

  while (Date.now() - t0 < maxMs) {
    if (Date.now() - lastShotAt > 30_000) {
      lastShotAt = Date.now();
      await page
        .screenshot({ path: path.join(OUT, `${outName}-progress.png`), fullPage: false })
        .catch(() => undefined);
      fs.writeFileSync(
        path.join(OUT, `${outName}-heartbeat.json`),
        JSON.stringify({ t: Date.now() - t0, phase: 'loop' }, null, 2)
      );
    }

    if (await acceptKeepIfPresent(page)) kept = true;

    const shimmer = page.locator('[data-artboard-process-shimmer]');
    if (await shimmer.count()) sawShimmer = true;

    const send = page.getByRole('button', { name: /send|发送/i }).first();
    const stop = page.getByRole('button', { name: /stop|停止|取消/i }).first();
    const stopVisible = await stop.isVisible({ timeout: 400 }).catch(() => false);
    if (stopVisible) sawStop = true;
    const sendEnabled = !(await Promise.race([
      send.isDisabled().catch(() => true),
      sleep(1_500).then(() => true),
    ]));

    const nodes = await countCanvasNodes(page);
    if (nodes > peakNodes) {
      peakNodes = nodes;
      lastGrowthAt = Date.now();
      if (nodes > opts.nodesBefore) sawOps = true;
    }
    const boardImgs = await page
      .locator('img')
      .evaluateAll((imgs) =>
        imgs.filter((img) => {
          const el = img as HTMLImageElement;
          return el.complete && el.naturalWidth > 80 && el.naturalHeight > 80;
        }).length
      )
      .catch(() => 0);
    if (boardImgs > 0) sawOps = true;

    const completedHint = await page
      .getByText(/completed the task|完成了任务|Canvas updated|画布已更新|Canvas content generated/i)
      .first()
      .isVisible({ timeout: 300 })
      .catch(() => false);

    // Suite stall rule: >150s without canvas growth while a run seems active.
    if (
      stopVisible &&
      !sawOps &&
      Date.now() - lastGrowthAt > 150_000 &&
      Date.now() - t0 > 150_000
    ) {
      stalledNoCanvas = true;
      await page.screenshot({
        path: path.join(OUT, `${outName}-stall.png`),
        fullPage: false,
      });
      break;
    }

    // Settle: task-complete / Keep — do not require Send enabled (models can stick disabled).
    if ((kept || completedHint) && !stopVisible && Date.now() - t0 > 10_000) break;
    if (sawStop && !stopVisible && sendEnabled && Date.now() - t0 > 15_000) break;
    if (!stopVisible && sendEnabled && sawOps && Date.now() - t0 > 25_000) break;
    if (!stopVisible && sawOps && completedHint && Date.now() - t0 > 20_000) break;

    fs.writeFileSync(
      path.join(OUT, `${outName}-heartbeat.json`),
      JSON.stringify(
        {
          t: Date.now() - t0,
          sawOps,
          sawStop,
          stopVisible,
          sendEnabled,
          kept,
          completedHint,
          nodes: peakNodes,
          boardImgs,
        },
        null,
        2
      )
    );
    await sleep(2_500);
  }

  await acceptKeepIfPresent(page);
  await page.screenshot({ path: path.join(OUT, `${outName}-final.png`), fullPage: false });
  return {
    sawOps: sawOps || kept,
    sawShimmer,
    sawStop: sawStop || kept,
    nodeDelta: peakNodes - opts.nodesBefore,
    ms: Date.now() - t0,
    stalledNoCanvas,
  };
}

test.describe('agent category eval (poster / UI / image)', () => {
  test.skip(!EVAL_ENABLED || !TOKEN, EVAL_SKIP_REASON);
  test.beforeAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
    expect(fs.existsSync(SUITE)).toBeTruthy();
    expect(TOKEN.length).toBeGreaterThan(10);
  });

  test('run selected category cases serially', async ({ page }) => {
    const cases = selectedCases();
    const boot = (step: string, extra?: Record<string, unknown>) => {
      fs.writeFileSync(
        path.join(OUT, 'boot.json'),
        JSON.stringify({ step, at: new Date().toISOString(), ...extra }, null, 2)
      );
    };
    fs.writeFileSync(
      path.join(OUT, 'plan.json'),
      JSON.stringify(
        { cases: cases.map((c) => c.id), startedAt: new Date().toISOString() },
        null,
        2
      )
    );

    boot('injectAuth');
    await injectAuth(page);
    boot('openEditor');
    await openEditor(page);
    boot('ensureAgentDock');
    await ensureAgentDock(page);
    boot('ready', { url: page.url() });
    await page.screenshot({ path: path.join(OUT, 'boot-editor.png'), fullPage: false });

    const results: CaseResult[] = [];
    for (const c of cases) {
      boot('case_start', { id: c.id });
      // Soft reload between cases — skip if it costs more than 20s (can hang the page).
      if (results.length > 0) {
        boot('reload', { id: c.id });
        try {
          await Promise.race([
            (async () => {
              await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
              await dismissBlockingDialogs(page);
              await ensureAgentDock(page);
              await sleep(800);
            })(),
            sleep(25_000).then(() => {
              throw new Error('reload_timeout');
            }),
          ]);
        } catch {
          boot('reload_skip', { id: c.id });
          await newChat(page).catch(() => undefined);
        }
      }
      const r = await runOneCase(page, c);
      results.push(r);
      boot('case_done', { id: c.id, ok: r.ok, ms: r.ms });
      fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results }, null, 2));
      expect(r.ok, `${c.id}: ${r.error || 'failed'}`).toBeTruthy();
    }

    const summary = {
      finishedAt: new Date().toISOString(),
      pass: results.filter((r) => r.ok).length,
      fail: results.filter((r) => !r.ok).length,
      results,
    };
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
    boot('done', summary);
  });
});
