#!/usr/bin/env node
/**
 * Full canvas stress matrix: Vitest store/bench + Playwright ops/generators/foundations.
 *
 * Usage:
 *   E2E_BASE_URL=http://127.0.0.1:3000 E2E_TOKEN=... E2E_API=http://127.0.0.1:8000 \
 *     node scripts/run-canvas-stress.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const results = [];

function run(name, command, args, opts = {}) {
  const started = Date.now();
  console.log(`\n=== ${name} ===`);
  const r = spawnSync(command, args, {
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...(opts.env || {}) },
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  const code = r.status == null ? 1 : r.status;
  const ms = Date.now() - started;
  results.push({ name, ok: code === 0, exit: code, ms });
  console.log(`RESULT ${name} exit=${code} ms=${ms}`);
  return code;
}

function resolveToken() {
  if (process.env.E2E_TOKEN?.trim()) return process.env.E2E_TOKEN.trim();
  if (process.env.FUNC_TOKEN?.trim()) return process.env.FUNC_TOKEN.trim();
  const p = resolve(ROOT, '.tmp-token.txt');
  if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  return '';
}

const token = resolveToken();
const e2eEnv = {
  E2E_BASE_URL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000',
  E2E_API: process.env.E2E_API || process.env.FUNC_API || 'http://127.0.0.1:8000',
  E2E_TOKEN: token,
  E2E_WORKERS: process.env.E2E_WORKERS || '1',
};

let failed = 0;

failed |= run(
  'web.canvasStress.bench',
  'npm',
  ['run', 'test:stress', '--workspace=apps/web']
);

failed |= run('web.canvasOps.store', 'npm', [
  'run',
  'test',
  '--workspace=apps/web',
  '--',
  'src/components/editor/nodes/__tests__/canvasOps.stress.test.ts',
  'src/components/editor/nodes/__tests__/canvasGenerators.store.test.ts',
  'src/components/editor/nodes/__tests__/quickEditGenPromptEcho.stress.test.ts',
  'src/components/editor/nodes/ImageNode/mark',
]);

failed |= run('web.rcb.regression', 'npm', [
  'run',
  'test',
  '--workspace=apps/web',
  '--',
  'src/components/rcb/selection/__tests__/postSplitCanvasRegression.test.ts',
  'src/components/rcb/selection/__tests__/screenChromeBodyTransform.test.ts',
  'src/components/rcb/tools/__tests__/penPathEditHitPads.test.ts',
  'src/components/rcb/scene/paint/__tests__/outlineTextSmallFont.test.ts',
  'src/components/rcb/scene/paint/__tests__/outlineTextKeepBeziers.test.ts',
  'src/components/rcb/scene/document/__tests__/sceneClipboardZod.test.ts',
]);

if (!token) {
  console.warn('WARN: no E2E_TOKEN — skipping Playwright canvas suites');
  results.push({ name: 'e2e.skipped', ok: true, exit: 0, ms: 0, note: 'no token' });
} else {
  failed |= run(
    'e2e.canvas.penGrid',
    'npx',
    ['playwright', 'test', 'tests/canvas.penGrid.spec.ts', '--reporter=list', '--workers=1', '--retries=0'],
    { cwd: resolve(ROOT, 'e2e'), env: e2eEnv }
  );
  failed |= run(
    'e2e.canvas.chromeAlign',
    'npx',
    ['playwright', 'test', 'tests/canvas.chromeAlign.spec.ts', '--reporter=list', '--workers=1', '--retries=0'],
    { cwd: resolve(ROOT, 'e2e'), env: e2eEnv }
  );
  failed |= run(
    'e2e.canvas.outlineHit',
    'npx',
    ['playwright', 'test', 'tests/canvas.outlineHit.spec.ts', '--reporter=list', '--workers=1', '--retries=0'],
    { cwd: resolve(ROOT, 'e2e'), env: e2eEnv }
  );
  failed |= run(
    'e2e.canvas.foundations',
    'npx',
    ['playwright', 'test', 'tests/canvas.foundations.spec.ts', '--reporter=list', '--workers=1'],
    { cwd: resolve(ROOT, 'e2e'), env: e2eEnv }
  );
  failed |= run(
    'e2e.canvas.stress.synthetic',
    'npx',
    ['playwright', 'test', 'tests/canvas.stress.spec.ts', '--reporter=list', '--workers=1'],
    { cwd: resolve(ROOT, 'e2e'), env: e2eEnv }
  );
  failed |= run(
    'e2e.canvas.generators',
    'npx',
    ['playwright', 'test', 'tests/canvas.generators.spec.ts', '--reporter=list', '--workers=1', '--retries=0'],
    { cwd: resolve(ROOT, 'e2e'), env: e2eEnv }
  );
  failed |= run(
    'e2e.canvas.ops.stress',
    'npx',
    ['playwright', 'test', 'tests/canvas.ops.stress.spec.ts', '--reporter=list', '--workers=1', '--retries=0'],
    { cwd: resolve(ROOT, 'e2e'), env: e2eEnv }
  );
  failed |= run(
    'e2e.canvas.deep.stress',
    'npx',
    ['playwright', 'test', 'tests/canvas.deep.stress.spec.ts', '--reporter=list', '--workers=1', '--retries=0'],
    { cwd: resolve(ROOT, 'e2e'), env: e2eEnv }
  );
  failed |= run(
    'e2e.canvas.tools.stress',
    'npx',
    ['playwright', 'test', 'tests/canvas.tools.stress.spec.ts', '--reporter=list', '--workers=1', '--retries=0'],
    { cwd: resolve(ROOT, 'e2e'), env: e2eEnv }
  );
}

const out = resolve(ROOT, '.tmp-canvas-stress-result.json');
writeFileSync(out, JSON.stringify({ results, failed: Boolean(failed) }, null, 2));
console.log(`\nWrote ${out}`);
console.log(JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
