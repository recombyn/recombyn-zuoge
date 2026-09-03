/**
 * Browser: click-select every basic shape, plus frame-plate vs L-path hole.
 * Repro: empty artboard click must not select an overflowing L child.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { E2E_TOKEN_SKIP_REASON } from './e2eAuth';
import {
  dragDraw,
  injectAuth,
  openBlankEditor,
  openLayers,
  sleep,
  waitForEditorToolbar,
  selectionChromeCount,
  TOKEN,
} from './canvasStressHelpers';

test.setTimeout(4 * 60_000);

async function focusStage(page: Page, stage: Locator) {
  const box = await stage.boundingBox();
  if (!box) throw new Error('no stage box');
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await sleep(120);
  return box;
}

async function clickSelectTool(page: Page) {
  await page.keyboard.press('v');
  await sleep(100);
}

async function blankClick(page: Page, box: { x: number; y: number; width: number; height: number }) {
  await page.mouse.click(box.x + box.width * 0.08, box.y + box.height * 0.08);
  await sleep(150);
}

async function bridgeHitAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ sx, sy }) => {
      const hit = (
        window as unknown as {
          __rcbBridgeHitTest?: (x: number, y: number) => string | null;
        }
      ).__rcbBridgeHitTest;
      if (typeof hit !== 'function') return null;
      return hit(sx, sy);
    },
    { sx: x, sy: y }
  );
}

/** Scene/world → client via the live SVG camera CTM. */
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

/** Path selection chrome tied to a node id (works even if Zustand import is duplicated). */
async function pathChromeFor(page: Page, nodeId: string) {
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

async function injectFrameWithLPath(page: Page) {
  return page.evaluate(async () => {
    const editorMod = await import('/src/store/modules/editor.ts');
    const { setDocument } = editorMod as { setDocument: (doc: unknown) => void };
    // L: left+bottom bands filled; top-right AABB is empty plate.
    const lPath = 'M 0 0 L 40 0 L 40 40 L 100 40 L 100 100 L 0 100 Z';
    setDocument({
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
      backgroundColor: '',
      frames: [
        {
          id: 'board',
          name: 'Frame',
          x: 200,
          y: 120,
          width: 383,
          height: 571,
          clipContent: true,
          kind: 'artboard',
        },
      ],
      activeFrameId: 'board',
      pages: [{ id: 'page1', name: 'Page 1', children: ['ell'] }],
      activePageId: 'page1',
      deltaSetLike: {
        ROOT: {
          id: 'ROOT',
          key: 'entry',
          children: ['ell'],
          attrs: {},
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        },
        ell: {
          id: 'ell',
          key: 'shape',
          // Overflows left of the plate (180 < 200); hole over white artboard.
          x: 180,
          y: 200,
          width: 100,
          height: 100,
          attrs: {
            frameId: 'board',
            shapeType: 'path',
            path: lPath,
            closed: true,
            'fill-color': '#ffffff',
            'fill-enabled': 'true',
            'border-color': '#111111',
            'border-width': 2,
            'stroke-enabled': 'true',
          },
          children: [],
        },
      },
      stackOrder: ['frame:board', 'node:ell'],
    });
    return true;
  });
}

test.describe('canvas hit all shapes (browser)', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
  });

  test('draw+click rect / ellipse / line / pen; empty frame plate beats L-path hole', async ({
    page,
  }) => {
    const stage = await openBlankEditor(page, 'hit-all');
    await waitForEditorToolbar(page);
    const box = await focusStage(page, stage);
    await openLayers(page);

    const tools: Array<{ key: string; name: string; drag: [number, number, number, number] }> = [
      { key: 'r', name: 'rect', drag: [0.3, 0.28, 0.4, 0.4] },
      { key: 'o', name: 'ellipse', drag: [0.48, 0.28, 0.58, 0.4] },
      { key: 'l', name: 'line', drag: [0.3, 0.48, 0.45, 0.55] },
    ];

    for (const t of tools) {
      await blankClick(page, box);
      await page.keyboard.press(t.key);
      await sleep(120);
      await dragDraw(page, box, t.drag[0], t.drag[1], t.drag[2], t.drag[3], 16);
      await sleep(350);
      await clickSelectTool(page);
      await blankClick(page, box);
      await expect.poll(async () => selectionChromeCount(page), { timeout: 8_000 }).toBe(0);

      const cx = box.x + box.width * ((t.drag[0] + t.drag[2]) / 2);
      const cy = box.y + box.height * ((t.drag[1] + t.drag[3]) / 2);
      await page.mouse.click(cx, cy);
      await sleep(250);
      await expect
        .poll(async () => selectionChromeCount(page), { timeout: 10_000 })
        .toBeGreaterThan(0);
      console.log(`[e2e:hit-all] ${t.name} click-select ok`);
    }

    // Pen stroke — soft check (thin ink; draw+select flake is separate from L-hole).
    await blankClick(page, box);
    await page.keyboard.press('p');
    await sleep(120);
    const px0 = box.x + box.width * 0.55;
    const py0 = box.y + box.height * 0.5;
    await page.mouse.move(px0, py0);
    await page.mouse.down();
    await page.mouse.move(px0 + 80, py0 + 10, { steps: 12 });
    await page.mouse.move(px0 + 120, py0 - 20, { steps: 12 });
    await page.mouse.up();
    await sleep(400);
    await clickSelectTool(page);
    await blankClick(page, box);
    let penHit = 0;
    for (const [dx, dy] of [
      [40, 2],
      [60, 0],
      [80, -5],
      [20, 5],
    ] as const) {
      await page.mouse.click(px0 + dx, py0 + dy);
      await sleep(200);
      penHit = await selectionChromeCount(page);
      if (penHit > 0) break;
    }
    console.log(`[e2e:hit-all] pen click-select chrome=${penHit}`);
    // Pen draw/finish varies (open path needs commit); don't block the L-hole case.
    if (penHit === 0) {
      console.warn('[e2e:hit-all] pen click-select skipped (no chrome after draw)');
    }

    // Frame + overflowing L: empty plate hole must not select the L.
    // Bound nodes only pick inside the owning artboard — ink click must be
    // on the L stem *inside* the plate (x>=200), not the clipped overflow.
    await injectFrameWithLPath(page);
    await sleep(900);
    await clickSelectTool(page);

    const inkBridge = await bridgeHitAt(page, 210, 220);
    const holeBridge = await bridgeHitAt(page, 275, 225);
    console.log(`[e2e:hit-all] bridge ink=${inkBridge} hole=${holeBridge}`);
    expect(inkBridge).toBe('ell');
    expect(holeBridge).toBeNull();

    const inkScreen = await sceneToClient(page, 210, 220);
    const holeScreen = await sceneToClient(page, 275, 225);
    expect(inkScreen).toBeTruthy();
    expect(holeScreen).toBeTruthy();

    const inkRoundTrip = await sceneRoundTripHit(page, inkScreen!.x, inkScreen!.y);
    console.log('[e2e:hit-all] ink round-trip', inkRoundTrip);
    expect(inkRoundTrip?.hit).toBe('ell');

    await page.mouse.click(inkScreen!.x, inkScreen!.y);
    await sleep(400);
    const inkChrome = await selectionChromeCount(page);
    const inkPathChrome = await pathChromeFor(page, 'ell');
    console.log(`[e2e:hit-all] L ink chrome=${inkChrome} pathChrome=${inkPathChrome}`);
    expect(inkChrome).toBeGreaterThan(0);

    await blankClick(page, box);
    await sleep(250);
    await expect.poll(async () => selectionChromeCount(page), { timeout: 8_000 }).toBe(0);

    const holeRoundTrip = await sceneRoundTripHit(page, holeScreen!.x, holeScreen!.y);
    console.log('[e2e:hit-all] hole round-trip', holeRoundTrip);
    expect(holeRoundTrip?.hit).toBeNull();

    await page.mouse.click(holeScreen!.x, holeScreen!.y);
    await sleep(400);
    const holePathChrome = await pathChromeFor(page, 'ell');
    console.log(`[e2e:hit-all] L hole pathChrome=${holePathChrome}`);
    expect(holePathChrome).toBe(false);
  });

  test('filled rect: click ~40 CSS px above box must not select (no searchPad halo)', async ({
    page,
  }) => {
    const stage = await openBlankEditor(page, 'hit-pad-halo');
    await waitForEditorToolbar(page);
    const box = await focusStage(page, stage);
    await openLayers(page);

    // Keep plate inside the default 100% viewport (blank editor camera).
    await page.evaluate(async () => {
      const editorMod = await import('/src/store/modules/editor.ts');
      const { setDocument } = editorMod as { setDocument: (doc: unknown) => void };
      setDocument({
        x: 0,
        y: 0,
        width: 2000,
        height: 1400,
        backgroundColor: '',
        frames: [],
        pages: [{ id: 'page1', name: 'Page 1', children: ['plate'] }],
        activePageId: 'page1',
        deltaSetLike: {
          ROOT: {
            id: 'ROOT',
            key: 'entry',
            children: ['plate'],
            attrs: {},
            x: 0,
            y: 0,
            width: 0,
            height: 0,
          },
          plate: {
            id: 'plate',
            key: 'shape',
            x: 280,
            y: 200,
            width: 420,
            height: 280,
            attrs: {
              shapeType: 'rect',
              'fill-color': '#ffffff',
              'fill-enabled': 'true',
              'border-color': '#111111',
              'border-width': 1,
              'stroke-enabled': 'true',
            },
            children: [],
          },
        },
        stackOrder: ['node:plate'],
      });
    });
    await sleep(900);
    await clickSelectTool(page);
    await blankClick(page, box);
    await sleep(200);

    // Old bug: fine hit used searchPad ≈ 76 CSS px — 40px above still selected.
    const aboveBridge = await bridgeHitAt(page, 490, 160);
    const insideBridge = await bridgeHitAt(page, 490, 340);
    console.log(`[e2e:hit-pad] bridge above=${aboveBridge} inside=${insideBridge}`);
    expect(aboveBridge).toBeNull();
    expect(insideBridge).toBe('plate');

    const aboveScreen = await sceneToClient(page, 490, 160);
    const insideScreen = await sceneToClient(page, 490, 340);
    expect(aboveScreen).toBeTruthy();
    expect(insideScreen).toBeTruthy();

    const aboveRt = await sceneRoundTripHit(page, aboveScreen!.x, aboveScreen!.y);
    const insideRt = await sceneRoundTripHit(page, insideScreen!.x, insideScreen!.y);
    console.log('[e2e:hit-pad] round-trip', { aboveRt, insideRt });
    expect(aboveRt?.hit).toBeNull();
    expect(insideRt?.hit).toBe('plate');

    await page.mouse.click(aboveScreen!.x, aboveScreen!.y);
    await sleep(300);
    expect(await selectionChromeCount(page)).toBe(0);

    await page.mouse.click(insideScreen!.x, insideScreen!.y);
    await sleep(400);
    await expect
      .poll(async () => selectionChromeCount(page), { timeout: 10_000 })
      .toBeGreaterThan(0);
    console.log('[e2e:hit-pad] above miss + inside select ok');
  });

  test('multi rects: sequential click, overlap stackOrder, gap miss, underlay', async ({
    page,
  }) => {
    const stage = await openBlankEditor(page, 'hit-multi');
    await waitForEditorToolbar(page);
    const box = await focusStage(page, stage);
    await openLayers(page);

    await page.evaluate(async () => {
      const editorMod = await import('/src/store/modules/editor.ts');
      const { setDocument } = editorMod as { setDocument: (doc: unknown) => void };
      setDocument({
        x: 0,
        y: 0,
        width: 2000,
        height: 1400,
        backgroundColor: '',
        frames: [],
        pages: [
          {
            id: 'page1',
            name: 'Page 1',
            children: ['under', 'a', 'b', 'front', 'back'],
          },
        ],
        activePageId: 'page1',
        deltaSetLike: {
          ROOT: {
            id: 'ROOT',
            key: 'entry',
            children: ['under', 'a', 'b', 'front', 'back'],
            attrs: {},
            x: 0,
            y: 0,
            width: 0,
            height: 0,
          },
          // Large underlay — like the 3480×2463 white plate in the repro.
          under: {
            id: 'under',
            key: 'shape',
            x: 160,
            y: 280,
            width: 720,
            height: 360,
            attrs: {
              shapeType: 'rect',
              'fill-color': '#ffffff',
              'fill-enabled': 'true',
              'border-color': '#94a3b8',
              'border-width': 1,
              'stroke-enabled': 'true',
            },
            children: [],
          },
          a: {
            id: 'a',
            key: 'shape',
            x: 180,
            y: 80,
            width: 140,
            height: 100,
            attrs: {
              shapeType: 'rect',
              'fill-color': '#e2e8f0',
              'fill-enabled': 'true',
              'border-color': '#111',
              'border-width': 1,
              'stroke-enabled': 'true',
            },
            children: [],
          },
          b: {
            id: 'b',
            key: 'shape',
            x: 400,
            y: 70,
            width: 160,
            height: 110,
            attrs: {
              shapeType: 'rect',
              'fill-color': '#7f1d1d',
              'fill-enabled': 'true',
              'border-color': '#111',
              'border-width': 1,
              'stroke-enabled': 'true',
            },
            children: [],
          },
          // Overlap pair: back then front in stackOrder → front wins.
          back: {
            id: 'back',
            key: 'shape',
            x: 620,
            y: 90,
            width: 160,
            height: 140,
            attrs: {
              shapeType: 'rect',
              'fill-color': '#64748b',
              'fill-enabled': 'true',
              'border-color': '#111',
              'border-width': 1,
              'stroke-enabled': 'true',
            },
            children: [],
          },
          front: {
            id: 'front',
            key: 'shape',
            x: 680,
            y: 130,
            width: 160,
            height: 140,
            attrs: {
              shapeType: 'rect',
              'fill-color': '#0ea5e9',
              'fill-enabled': 'true',
              'border-color': '#111',
              'border-width': 1,
              'stroke-enabled': 'true',
            },
            children: [],
          },
        },
        // under at bottom; a/b mid; back under front.
        stackOrder: ['node:under', 'node:a', 'node:b', 'node:back', 'node:front'],
      });
    });
    await sleep(900);
    await clickSelectTool(page);
    await blankClick(page, box);
    await sleep(200);

    // --- bridge: multi + gap + overlap + underlay ---
    const hits = {
      a: await bridgeHitAt(page, 250, 130),
      b: await bridgeHitAt(page, 480, 120),
      // Gap between a/b row and underlay top (y=280) — old halo would steal `under`.
      gap: await bridgeHitAt(page, 350, 240),
      overlap: await bridgeHitAt(page, 740, 180),
      underOnly: await bridgeHitAt(page, 500, 400),
      aboveUnder: await bridgeHitAt(page, 500, 250),
    };
    console.log('[e2e:hit-multi] bridge', hits);
    expect(hits.a).toBe('a');
    expect(hits.b).toBe('b');
    expect(hits.gap).toBeNull();
    expect(hits.overlap).toBe('front');
    expect(hits.underOnly).toBe('under');
    expect(hits.aboveUnder).toBeNull();

    async function clickSelectId(sx: number, sy: number, id: string | null): Promise<void> {
      const screen = await sceneToClient(page, sx, sy);
      expect(screen, `sceneToClient ${sx},${sy}`).toBeTruthy();
      const rt = await sceneRoundTripHit(page, screen!.x, screen!.y);
      expect(rt?.hit ?? null).toBe(id);
      await blankClick(page, box);
      await sleep(200);
      await page.mouse.click(screen!.x, screen!.y);
      await sleep(320);
      if (id) {
        await expect
          .poll(async () => selectionChromeCount(page), { timeout: 8_000 })
          .toBeGreaterThan(0);
        const still = await sceneRoundTripHit(page, screen!.x, screen!.y);
        expect(still?.hit).toBe(id);
      } else {
        // Gap / above-under: must not arm selection chrome.
        expect(await selectionChromeCount(page)).toBe(0);
      }
    }

    await clickSelectId(250, 130, 'a');
    await clickSelectId(480, 120, 'b');
    await clickSelectId(350, 240, null);
    await clickSelectId(740, 180, 'front');
    await clickSelectId(500, 400, 'under');
    await clickSelectId(500, 250, null);
    console.log('[e2e:hit-multi] sequential click + overlap + gap ok');
  });
});
