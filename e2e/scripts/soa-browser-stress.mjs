/**
 * Browser SoA stress: seed N shapes via API document, open editor, measure pan FPS.
 * Usage: node scripts/soa-browser-stress.mjs [count=1000]
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const TOKEN = fs.readFileSync(path.join(ROOT, '.tmp-token.txt'), 'utf8').trim();
const API = 'http://127.0.0.1:8000';
const WEB = 'http://127.0.0.1:3000';
const COUNT = Math.max(50, Number(process.argv[2] || process.env.SOA_BROWSER_N || 1000) || 1000);

function log(...args) {
  console.log('[soa-browser]', ...args);
}

function buildDocument(n) {
  const cols = Math.ceil(Math.sqrt(n));
  const cell = 28;
  const boardW = cols * cell + 64;
  const boardH = Math.ceil(n / cols) * cell + 64;
  const children = [];
  const deltaSetLike = {
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
    const id = `s${i}`;
    children.push(id);
    deltaSetLike[id] = {
      id,
      key: 'shape',
      x: (i % cols) * cell,
      y: Math.floor(i / cols) * cell,
      width: 48,
      height: 48,
      attrs: {
        shapeType: 'rect',
        'fill-color': '#ffffff',
        'border-color': '#111111',
        'border-width': 1,
        frameId: 'board',
        frameOrder: i,
      },
      children: [],
    };
  }
  return {
    x: 0,
    y: 0,
    width: boardW,
    height: boardH,
    backgroundColor: '',
    frames: [
      {
        id: 'board',
        name: 'Board',
        x: 0,
        y: 0,
        width: boardW,
        height: boardH,
        clipContent: true,
        kind: 'artboard',
      },
    ],
    activeFrameId: 'board',
    pages: [{ id: 'page1', name: 'Page 1', children: children.slice() }],
    activePageId: 'page1',
    deltaSetLike,
    stackOrder: ['frame:board'],
  };
}

log('build document N=', COUNT);
const tDoc0 = Date.now();
const document = buildDocument(COUNT);
log('buildDocMs', Date.now() - tDoc0);

const browser = await chromium.launch({
  headless: process.env.SOA_HEADED === '1' ? false : true,
  args: ['--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(180_000);

const meRes = await page.request.get(`${API}/api/v1/auth/me`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
});
if (!meRes.ok()) throw new Error(`auth/me ${meRes.status()}`);
const me = await meRes.json();
await page.addInitScript(
  ({ tok, u }) => {
    localStorage.setItem('recombine-auth-token-v1', tok);
    localStorage.setItem('resume-scene-auth-v1', JSON.stringify({ user: u }));
    localStorage.setItem('recombyn-editor-tour-v3', '1');
    localStorage.setItem('recombyn-editor-tour-v3:user_super_admin', '1');
  },
  { tok: TOKEN, u: me.user }
);

log('create project via API…');
const tCreate0 = Date.now();
const createRes = await page.request.put(`${API}/api/v1/projects`, {
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  data: { name: `soa-stress-${COUNT}-${Date.now()}`, document },
  timeout: 180_000,
});
const createMs = Date.now() - tCreate0;
if (!createRes.ok()) {
  throw new Error(`create project ${createRes.status()} ${await createRes.text()}`);
}
const created = await createRes.json();
const projectId = String(created?.project?.id || created?.id || '').trim();
if (!projectId) throw new Error('missing project id');
log('project', projectId, 'createMs', createMs);

log('goto editor…');
await page.goto(`${WEB}/editor/${projectId}`, { waitUntil: 'load', timeout: 120_000 });

log('wait stage + shapes layer…');
let ready = false;
for (let i = 0; i < 90; i += 1) {
  const stageN = await page.locator('[data-rcb-canvas="1"]').count();
  const layerN = await page.locator('[data-rcb-shapes-layer="1"]').count();
  const inkN = await page.locator('[data-rcb-idle-ink-canvas]').count();
  if (stageN > 0 && (layerN > 0 || inkN > 0 || i > 25)) {
    ready = stageN > 0;
    if (i > 25 || layerN > 0 || inkN > 0) break;
  }
  await page.waitForTimeout(1000);
  if (i % 5 === 4) {
    log(
      'waiting',
      i + 1,
      's stage',
      stageN,
      'layer',
      layerN,
      'ink',
      inkN,
      'body',
      (await page.locator('body').innerText()).slice(0, 48).replace(/\s+/g, ' ')
    );
  }
}
if (!ready) throw new Error('stage never appeared');
log('stage ready');
await page.keyboard.press('Escape');
await page.waitForTimeout(800);

const counts = await page.evaluate(() => {
  const layer = document.querySelector('[data-rcb-shapes-layer="1"]');
  const rcb = document.querySelector('[data-rcb-canvas="1"]');
  return {
    fullHost: Number(layer?.getAttribute('data-rcb-full-host-count') || -1),
    canvasIdle: Number(
      layer?.getAttribute('data-rcb-canvas-idle-count') ||
        rcb?.getAttribute('data-rcb-canvas-idle-count') ||
        -1
    ),
    visible: Number(layer?.getAttribute('data-rcb-visible-count') || -1),
    hasInkCanvas: Boolean(document.querySelector('[data-rcb-idle-ink-canvas]')),
    sceneNodeHosts: document.querySelectorAll('[data-scene-node-id]').length,
  };
});
log('counts', counts);

log('pan measure…');
const stage = page.locator('[data-rcb-canvas="1"]').first();
const box = await stage.boundingBox();
if (!box) throw new Error('no stage box');
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
await page.keyboard.down(' ');
await page.mouse.down();
const measuring = page.evaluate(async () => {
  const dts = [];
  let last = performance.now();
  const deadline = last + 4000;
  for (let i = 0; i < 45 && performance.now() < deadline; i += 1) {
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now();
    dts.push(now - last);
    last = now;
  }
  return dts.slice(5);
});
for (let i = 0; i < 20; i += 1) {
  await page.mouse.move(cx + i * 18, cy + ((i % 3) - 1) * 12);
  await page.waitForTimeout(20);
}
await page.mouse.up();
await page.keyboard.up(' ');
let dts = [];
try {
  dts = await Promise.race([
    measuring,
    page.waitForTimeout(6000).then(() => []),
  ]);
} catch {
  dts = [];
}
const avg = dts.length ? dts.reduce((a, b) => a + b, 0) / dts.length : -1;
const sorted = [...dts].sort((a, b) => a - b);
const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] || 0 : -1;
const pan = {
  avgFrameMs: avg < 0 ? -1 : Math.round(avg * 100) / 100,
  p95FrameMs: p95 < 0 ? -1 : Math.round(p95 * 100) / 100,
  samples: dts.length,
};
log('pan', pan);

const report = {
  n: COUNT,
  createMs,
  counts,
  pan,
  at: new Date().toISOString(),
};
const out = path.join(__dirname, `soa-browser-${COUNT}.json`);
fs.writeFileSync(out, JSON.stringify(report, null, 2));
await page.screenshot({ path: path.join(__dirname, `soa-browser-${COUNT}.png`), fullPage: false });
log('wrote', out);
log('REPORT\n' + JSON.stringify(report, null, 2));
await page.waitForTimeout(1200);
await browser.close();
