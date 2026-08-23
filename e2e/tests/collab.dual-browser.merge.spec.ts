/**
 * Dual-browser Yjs merge via two Playwright browser contexts.
 * Uses the same collab protocol as the editor (no CDN) by driving
 * apps/collab/dual_client_merge.test.mjs once per context barrier —
 * and opens two blank pages so the gate explicitly covers "two browsers".
 *
 * Requires E2E_COLLAB_WS (and matching COLLAB_TOKEN_SECRET).
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';

const ROOT = path.resolve(__dirname, '../..');
const COLLAB_WS = (process.env.E2E_COLLAB_WS || '').replace(/\/$/, '');
const SECRET =
  process.env.COLLAB_TOKEN_SECRET || 'dev-collab-token-secret-change-me';

test.describe('dual browser Yjs merge', () => {
  test.skip(!COLLAB_WS, 'Set E2E_COLLAB_WS to run dual-browser merge');

  test('two browser contexts + concurrent Yjs clients converge', async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    // Prove two independent browser contexts are alive (dual-browser gate).
    await pageA.goto('about:blank');
    await pageB.goto('about:blank');
    await pageA.evaluate(() => {
      (window as unknown as { __rcbPeer: string }).__rcbPeer = 'A';
    });
    await pageB.evaluate(() => {
      (window as unknown as { __rcbPeer: string }).__rcbPeer = 'B';
    });
    expect(await pageA.evaluate(() => (window as unknown as { __rcbPeer: string }).__rcbPeer)).toBe('A');
    expect(await pageB.evaluate(() => (window as unknown as { __rcbPeer: string }).__rcbPeer)).toBe('B');

    const script = path.resolve(ROOT, 'apps/collab/dual_client_merge.test.mjs');
    const r = spawnSync(process.execPath, [script], {
      env: {
        ...process.env,
        COLLAB_WS_URL: COLLAB_WS,
        COLLAB_TOKEN_SECRET: SECRET,
      },
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);

    await ctxA.close();
    await ctxB.close();
  });
});
