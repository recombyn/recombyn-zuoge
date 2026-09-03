/**
 * Comprehensive browser hit matrix — inject controlled scene, assert bridge +
 * single-click chrome for every common ink type and stacking case.
 */
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { E2E_TOKEN_SKIP_REASON } from './e2eAuth';
import {
  injectAuth,
  openBlankEditor,
  sleep,
  waitForEditorToolbar,
  selectionChromeCount,
  TOKEN,
} from './canvasStressHelpers';

test.setTimeout(6 * 60_000);

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type HitCase = {
  id: string;
  label: string;
  x: number;
  y: number;
  expectHit: string | null;
  clickSelect?: boolean;
};

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

async function nodeChrome(page: Page, nodeId: string) {
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

async function anySelChrome(page: Page) {
  return page.evaluate(() => Boolean(document.querySelector('g[data-rcb-sel-chrome="1"]')));
}

async function sceneRoundTripHit(page: Page, clientX: number, clientY: number) {
  return page.evaluate(
    ({ cx, cy }) => {
      const cam = document.querySelector('g[data-rcb-scene-camera]') as SVGGElement | null;
      const svg = cam?.ownerSVGElement;
      const ctm = cam?.getScreenCTM();
      if (!cam || !svg || !ctm) return null;
      const inv = ctm.inverse();
      const pt = svg.createSVGPoint();
      pt.x = cx;
      pt.y = cy;
      const scene = pt.matrixTransform(inv);
      const hit = (
        window as unknown as {
          __rcbBridgeHitTest?: (x: number, y: number) => string | null;
        }
      ).__rcbBridgeHitTest;
      return {
        sceneX: scene.x,
        sceneY: scene.y,
        hit: typeof hit === 'function' ? hit(scene.x, scene.y) : null,
      };
    },
    { cx: clientX, cy: clientY }
  );
}

async function blankAway(page: Page) {
  const stage = page.locator('[data-rcb-canvas="1"]').first();
  const box = await stage.boundingBox();
  if (!box) return;
  await page.mouse.click(box.x + 12, box.y + 12);
  await sleep(150);
}

async function injectHitMatrixDoc(page: Page) {
  return page.evaluate(
    async ({ png }) => {
      const mod = await import('/src/store/modules/editor.ts');
      const setDocument = (mod as { setDocument: (doc: unknown) => void }).setDocument;
      const pathD = 'M 4 4 L 56 4 L 56 28 L 28 28 L 28 56 L 4 56 Z';
      const diamond = 'M 30 4 L 56 30 L 30 56 L 4 30 Z';
      const children = [
        'rect1',
        'ell1',
        'line1',
        'path1',
        'poly1',
        'text1',
        'img1',
        'vid1',
        'back',
        'front',
        'under',
        'overWorld',
        'lhole',
      ];
      const deltaSetLike: Record<string, unknown> = {
        ROOT: {
          id: 'ROOT',
          key: 'entry',
          children: children.slice(),
          attrs: {},
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        },
        rect1: {
          id: 'rect1',
          key: 'shape',
          x: 40,
          y: 40,
          width: 90,
          height: 60,
          attrs: {
            shapeType: 'rect',
            'fill-color': '#BFDBFE',
            'fill-enabled': 'true',
            'border-width': 1,
            frameId: 'board',
            frameOrder: 0,
          },
          children: [],
        },
        ell1: {
          id: 'ell1',
          key: 'shape',
          x: 160,
          y: 40,
          width: 90,
          height: 60,
          attrs: {
            shapeType: 'ellipse',
            'fill-color': '#FBCFE8',
            'fill-enabled': 'true',
            frameId: 'board',
            frameOrder: 1,
          },
          children: [],
        },
        line1: {
          id: 'line1',
          key: 'shape',
          // Product lines use height=1 (STROKE_GEOMETRY_HEIGHT); thickness is border-width.
          x: 280,
          y: 50,
          width: 100,
          height: 1,
          attrs: {
            shapeType: 'line',
            'border-width': 10,
            'border-color': '#111',
            'stroke-enabled': 'true',
            'stroke-visible': 'true',
            strokeAlign: 'center',
            strokeLinecap: 'butt',
            strokeLinejoin: 'miter',
            'fill-enabled': 'false',
            'fill-color': 'transparent',
            angle: 0,
            frameId: 'board',
            frameOrder: 2,
          },
          children: [],
        },
        path1: {
          id: 'path1',
          key: 'shape',
          x: 40,
          y: 130,
          width: 60,
          height: 60,
          attrs: {
            shapeType: 'path',
            path: pathD,
            closed: true,
            'fill-color': '#FEF08A',
            'fill-enabled': 'true',
            frameId: 'board',
            frameOrder: 3,
          },
          children: [],
        },
        poly1: {
          id: 'poly1',
          key: 'shape',
          x: 130,
          y: 130,
          width: 70,
          height: 70,
          attrs: {
            shapeType: 'polygon',
            sides: 6,
            'fill-color': '#A7F3D0',
            'fill-enabled': 'true',
            frameId: 'board',
            frameOrder: 4,
          },
          children: [],
        },
        text1: {
          id: 'text1',
          key: 'text',
          x: 230,
          y: 140,
          width: 120,
          height: 36,
          attrs: {
            markdown: 'HitMe',
            DATA: 'HitMe',
            fontSize: 18,
            frameId: 'board',
            frameOrder: 5,
          },
          children: [],
        },
        img1: {
          id: 'img1',
          key: 'image',
          x: 40,
          y: 220,
          width: 64,
          height: 64,
          attrs: { src: png, frameId: 'board', frameOrder: 6 },
          children: [],
        },
        vid1: {
          id: 'vid1',
          key: 'video',
          x: 130,
          y: 220,
          width: 80,
          height: 56,
          attrs: { src: '', poster: png, frameId: 'board', frameOrder: 7 },
          children: [],
        },
        // Overlap stack on board: back under front
        back: {
          id: 'back',
          key: 'shape',
          x: 280,
          y: 200,
          width: 100,
          height: 80,
          attrs: {
            shapeType: 'rect',
            'fill-color': '#FCA5A5',
            'fill-enabled': 'true',
            frameId: 'board',
            frameOrder: 8,
          },
          children: [],
        },
        front: {
          id: 'front',
          key: 'shape',
          x: 310,
          y: 220,
          width: 100,
          height: 80,
          attrs: {
            shapeType: 'rect',
            'fill-color': '#86EFAC',
            'fill-enabled': 'true',
            frameId: 'board',
            frameOrder: 9,
          },
          children: [],
        },
        // World under animation plate
        under: {
          id: 'under',
          key: 'shape',
          x: 520,
          y: 80,
          width: 160,
          height: 120,
          attrs: {
            shapeType: 'rect',
            'fill-color': '#CBD5E1',
            'fill-enabled': 'true',
          },
          children: [],
        },
        // World above board (stack after frame:board)
        overWorld: {
          id: 'overWorld',
          key: 'shape',
          x: 360,
          y: 40,
          width: 70,
          height: 50,
          attrs: {
            shapeType: 'rect',
            'fill-color': '#C4B5FD',
            'fill-enabled': 'true',
          },
          children: [],
        },
        // L-path on board — hole empty
        lhole: {
          id: 'lhole',
          key: 'shape',
          x: 220,
          y: 300,
          width: 100,
          height: 100,
          attrs: {
            shapeType: 'path',
            path: diamond,
            closed: true,
            'fill-color': '#FDBA74',
            'fill-enabled': 'true',
            frameId: 'board',
            frameOrder: 10,
          },
          children: [],
        },
      };

      setDocument({
        x: 0,
        y: 0,
        width: 1100,
        height: 700,
        backgroundColor: '',
        frames: [
          {
            id: 'board',
            name: 'Board',
            x: 20,
            y: 20,
            width: 460,
            height: 420,
            clipContent: true,
            kind: 'artboard',
          },
          {
            id: 'anim',
            name: 'Anim',
            x: 500,
            y: 60,
            width: 220,
            height: 180,
            clipContent: true,
            kind: 'animation',
          },
        ],
        activeFrameId: 'board',
        pages: [{ id: 'page1', name: 'Page 1', children: children.slice() }],
        activePageId: 'page1',
        deltaSetLike,
        // board, then world under, then anim on top of under, then overWorld above board
        stackOrder: ['frame:board', 'node:under', 'frame:anim', 'node:overWorld'],
      });
      return true;
    },
    { png: TINY_PNG }
  );
}

async function hasSelectionChrome(page: Page, nodeId: string): Promise<boolean> {
  if (await nodeChrome(page, nodeId)) return true;
  if (await anySelChrome(page)) return true;
  return (await selectionChromeCount(page)) > 0;
}

async function clickSelectAtScene(
  page: Page,
  sx: number,
  sy: number,
  expectHit: string,
  label: string
): Promise<boolean> {
  await blankAway(page);
  await expect.poll(async () => selectionChromeCount(page), { timeout: 6_000 }).toBe(0);
  expect(await bridgeHit(page, sx, sy), `${label} pre-click bridge`).toBe(expectHit);
  const client = await sceneToClient(page, sx, sy);
  expect(client, `${label} sceneToClient`).toBeTruthy();
  const rt = await sceneRoundTripHit(page, client!.x, client!.y);
  expect(rt?.hit, `${label} round-trip`).toBe(expectHit);

  const offsets: Array<[number, number]> = [
    [0, 0],
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
  ];
  for (const [ox, oy] of offsets) {
    if (ox || oy) await blankAway(page);
    await page.mouse.click(client!.x + ox, client!.y + oy);
    await sleep(ox || oy ? 200 : 280);
    if (await hasSelectionChrome(page, expectHit)) return true;
  }
  return false;
}

test.describe('canvas hit matrix (browser)', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
  });

  test('matrix: shapes + stack + anim plate + single-click', async ({ page }) => {
    await openBlankEditor(page, 'hit-matrix');
    await waitForEditorToolbar(page);
    await injectHitMatrixDoc(page);
    await sleep(1000);
    await page.keyboard.press('v');
    await sleep(150);

    const cases: HitCase[] = [
      { id: 'rect1', label: 'rect center', x: 85, y: 70, expectHit: 'rect1', clickSelect: true },
      { id: 'ell1', label: 'ellipse center', x: 205, y: 70, expectHit: 'ell1', clickSelect: true },
      { id: 'line1', label: 'line mid', x: 330, y: 50.5, expectHit: 'line1', clickSelect: true },
      { id: 'path1', label: 'path fill', x: 55, y: 150, expectHit: 'path1', clickSelect: true },
      { id: 'poly1', label: 'polygon', x: 165, y: 165, expectHit: 'poly1', clickSelect: true },
      { id: 'text1', label: 'text', x: 270, y: 155, expectHit: 'text1', clickSelect: true },
      { id: 'img1', label: 'image', x: 72, y: 252, expectHit: 'img1', clickSelect: true },
      { id: 'vid1', label: 'video poster', x: 170, y: 248, expectHit: 'vid1', clickSelect: true },
      { id: 'front', label: 'overlap top', x: 340, y: 250, expectHit: 'front', clickSelect: true },
      { id: 'back-miss', label: 'overlap covered', x: 300, y: 230, expectHit: 'front', clickSelect: false },
      {
        id: 'overWorld',
        label: 'world above board',
        x: 395,
        y: 65,
        expectHit: 'overWorld',
        clickSelect: true,
      },
      { id: 'anim-occlude', label: 'anim over under', x: 580, y: 140, expectHit: null, clickSelect: false },
      { id: 'lhole-ink', label: 'diamond ink', x: 270, y: 330, expectHit: 'lhole', clickSelect: true },
    ];

    const rows: Array<Record<string, unknown>> = [];

    for (const c of cases) {
      const hit = await bridgeHit(page, c.x, c.y);
      let chromeOk: boolean | null = null;
      let clicked = false;

      if (c.clickSelect && c.expectHit) {
        clicked = true;
        chromeOk = await clickSelectAtScene(page, c.x, c.y, c.expectHit, c.label);
        expect(chromeOk, `${c.label} single-click chrome`).toBe(true);
      }

      if (c.id === 'anim-occlude') {
        await blankAway(page);
        const client = await sceneToClient(page, c.x, c.y);
        expect(client).toBeTruthy();
        await page.mouse.click(client!.x, client!.y);
        clicked = true;
        await sleep(280);
        const underNode = await nodeChrome(page, 'under');
        const plateChrome = await anySelChrome(page);
        chromeOk = !underNode && plateChrome;
        expect(underNode).toBe(false);
        expect(plateChrome).toBe(true);
      }

      const row = {
        id: c.id,
        label: c.label,
        expectHit: c.expectHit,
        hit,
        hitOk: hit === c.expectHit,
        clicked,
        chromeOk,
      };
      rows.push(row);
      console.log('[e2e:hit-matrix]', JSON.stringify(row));
      expect(hit, `${c.label} bridge`).toBe(c.expectHit);
    }

    await blankAway(page);
    const client = await sceneToClient(page, 85, 70);
    await page.mouse.click(client!.x, client!.y);
    await sleep(200);
    expect(await anySelChrome(page)).toBe(true);

    const report = {
      generatedAt: new Date().toISOString(),
      rows,
      allBridgeOk: rows.every((r) => r.hitOk === true),
      clickRows: rows.filter((r) => r.clicked),
    };
    writeFileSync(
      path.resolve(__dirname, 'canvas.hitMatrix.browser.results.json'),
      JSON.stringify(report, null, 2),
      'utf8'
    );
    expect(report.allBridgeOk).toBe(true);
  });
});
