/**
 * Browser: single-click select + higher animation plate over world rects.
 */
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { E2E_TOKEN_SKIP_REASON } from './e2eAuth';
import {
  TOKEN,
  injectAuth,
  openBlankEditor,
  sleep,
  waitForEditorToolbar,
  selectionChromeCount,
} from './canvasStressHelpers';

test.setTimeout(3 * 60_000);

async function injectOverlapDoc(page: Page, rectCount: number) {
  return page.evaluate(async ({ n }) => {
    const mod = await import('/src/store/modules/editor.ts');
    const setDocument = (mod as { setDocument: (doc: unknown) => void }).setDocument;
    const children: string[] = [];
    const deltaSetLike: Record<string, unknown> = {
      ROOT: {
        id: 'ROOT',
        key: 'entry',
        children,
        attrs: {},
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
    };
    for (let i = 0; i < n; i += 1) {
      const id = `r${i}`;
      children.push(id);
      deltaSetLike[id] = {
        id,
        key: 'shape',
        x: 40 + (i % 10) * 18,
        y: 40 + Math.floor(i / 10) * 18,
        width: 28,
        height: 28,
        attrs: {
          shapeType: 'rect',
          'fill-color': '#94A3B8',
          'fill-enabled': 'true',
          'border-width': 1,
          'border-color': '#334155',
        },
        children: [],
      };
    }
    setDocument({
      x: 0,
      y: 0,
      width: 900,
      height: 700,
      backgroundColor: '',
      frames: [
        {
          id: 'anim',
          name: 'Anim',
          x: 20,
          y: 20,
          width: 420,
          height: 320,
          clipContent: true,
          kind: 'animation',
        },
      ],
      activeFrameId: 'anim',
      pages: [{ id: 'page1', name: 'Page 1', children: children.slice() }],
      activePageId: 'page1',
      deltaSetLike,
      stackOrder: [...children.map((id) => `node:${id}`), 'frame:anim'],
    });
    return { n };
  }, { n: rectCount });
}

async function sceneToClient(page: Page, sx: number, sy: number) {
  return page.evaluate(
    ({ x, y }) => {
      const cam = document.querySelector('g[data-rcb-scene-camera]') as SVGGElement | null;
      const svg = cam?.ownerSVGElement;
      if (!cam || !svg || typeof svg.createSVGPoint !== 'function') return null;
      const ctm = cam.getScreenCTM();
      if (!ctm) return null;
      const pt = svg.createSVGPoint();
      pt.x = x;
      pt.y = y;
      const out = pt.matrixTransform(ctm);
      return { x: out.x, y: out.y };
    },
    { x: sx, y: sy }
  );
}

async function bridgeHit(page: Page, sx: number, sy: number) {
  return page.evaluate(
    ({ x, y }) => {
      const hit = (
        window as unknown as {
          __rcbBridgeHitTest?: (x: number, y: number) => string | null;
        }
      ).__rcbBridgeHitTest;
      return typeof hit === 'function' ? hit(x, y) : null;
    },
    { x: sx, y: sy }
  );
}

async function selectionChromeFor(page: Page, nodeId: string) {
  return page.evaluate((id) => {
    const edge = document.querySelector(`[data-rcb-sel-edge-for="${CSS.escape(id)}"]`);
    const outline = document.querySelector(
      `[data-rcb-sel-outline][data-scene-node-id="${CSS.escape(id)}"]`
    );
    const hostSel = document.querySelector(
      `[data-rcb-shape-host="${CSS.escape(id)}"][data-selected="1"]`
    );
    return Boolean(edge || outline || hostSel);
  }, nodeId);
}

async function frameSelectedUi(page: Page, frameId: string) {
  return page.evaluate((fid) => {
    const plate = document.querySelector(`[data-rcb-frame="${CSS.escape(fid)}"]`);
    const selected =
      plate?.getAttribute('data-selected') === '1' ||
      plate?.getAttribute('data-rcb-frame-selected') === '1' ||
      Boolean(document.querySelector(`[data-rcb-frame-sel="${CSS.escape(fid)}"]`)) ||
      Boolean(document.querySelector(`g[data-rcb-sel-chrome="1"]`));
    return {
      selected,
      plate: Boolean(plate),
      chrome: Boolean(document.querySelector('g[data-rcb-sel-chrome="1"]')),
    };
  }, frameId);
}

test.describe('hit overlap / single-click', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
  });

  test('animation plate over 80 rects — single click selects plate not under-rect', async ({
    page,
  }) => {
    const stage = await openBlankEditor(page, 'hit-overlap');
    await waitForEditorToolbar(page);
    await injectOverlapDoc(page, 80);
    await sleep(800);
    await page.keyboard.press('v');
    await sleep(120);

    const hitId = await bridgeHit(page, 200, 160);
    expect(hitId).toBeNull();

    const client = await sceneToClient(page, 200, 160);
    expect(client).toBeTruthy();
    await page.mouse.click(client!.x, client!.y);
    await sleep(350);

    const ui = await frameSelectedUi(page, 'anim');
    const underChrome = await selectionChromeFor(page, 'r0');
    const report = { hitId, client, ui, underChrome };
    console.log('[e2e:hit-overlap]', JSON.stringify(report));
    writeFileSync(
      path.resolve(__dirname, 'canvas.hitOverlap.browser.results.json'),
      JSON.stringify(report, null, 2),
      'utf8'
    );

    expect(underChrome).toBe(false);
    expect(hitId).toBeNull();
    expect(ui.chrome || ui.selected || ui.plate).toBe(true);
    await expect(stage).toBeVisible();
  });

  test('lonely rect single-clicks with one press', async ({ page }) => {
    const stage = await openBlankEditor(page, 'hit-solo');
    await waitForEditorToolbar(page);
    await page.evaluate(async () => {
      const mod = await import('/src/store/modules/editor.ts');
      const setDocument = (mod as { setDocument: (doc: unknown) => void }).setDocument;
      setDocument({
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        backgroundColor: '',
        frames: [
          {
            id: 'board',
            name: 'Board',
            x: 0,
            y: 0,
            width: 800,
            height: 600,
            clipContent: true,
            kind: 'artboard',
          },
        ],
        activeFrameId: 'board',
        pages: [{ id: 'page1', name: 'Page 1', children: ['solo'] }],
        activePageId: 'page1',
        deltaSetLike: {
          ROOT: {
            id: 'ROOT',
            key: 'entry',
            children: ['solo'],
            attrs: {},
            x: 0,
            y: 0,
            width: 0,
            height: 0,
          },
          solo: {
            id: 'solo',
            key: 'shape',
            x: 120,
            y: 100,
            width: 120,
            height: 80,
            attrs: {
              shapeType: 'rect',
              'fill-color': '#FDE68A',
              'fill-enabled': 'true',
              frameId: 'board',
              frameOrder: 0,
            },
            children: [],
          },
        },
        stackOrder: ['frame:board'],
      });
    });
    await sleep(600);
    await page.keyboard.press('v');
    await sleep(100);

    expect(await bridgeHit(page, 180, 140)).toBe('solo');
    const client = await sceneToClient(page, 180, 140);
    expect(client).toBeTruthy();
    await page.mouse.click(client!.x, client!.y);
    await expect
      .poll(async () => {
        if (await selectionChromeFor(page, 'solo')) return true;
        return (await selectionChromeCount(page)) > 0;
      }, { timeout: 5_000 })
      .toBe(true);
    await expect(stage).toBeVisible();
  });
});
