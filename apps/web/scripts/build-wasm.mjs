#!/usr/bin/env node
/**
 * Build packages/rcb-wasm-geom → apps/web/.../vector/wasm/pkg
 * Requires: rustc, wasm-pack, wasm32-unknown-unknown target.
 * On failure exits 0 with a note so CI without Rust still passes (JS fallback).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(webRoot, '../..');
const crateDir = path.join(repoRoot, 'packages/rcb-wasm-geom');
const outDir = path.join(
  webRoot,
  'src/components/rcb/render/vector/wasm/pkg'
);

function hasCmd(cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: true });
  return r.status === 0;
}

function writeStub() {
  fs.mkdirSync(outDir, { recursive: true });
  const stub = `/* Auto stub — run: npm run build:wasm */\nexport default async function init() { throw new Error('rcb-wasm-geom not built'); }\n`;
  fs.writeFileSync(path.join(outDir, 'rcb_wasm_geom.js'), stub);
  fs.writeFileSync(
    path.join(outDir, 'package.json'),
    JSON.stringify({ name: 'rcb-wasm-geom', type: 'module', main: 'rcb_wasm_geom.js' }, null, 2)
  );
  console.warn('[build-wasm] stub written (wasm-pack unavailable) — JS fallback active');
}

if (!fs.existsSync(path.join(crateDir, 'Cargo.toml'))) {
  console.error('[build-wasm] missing crate', crateDir);
  process.exit(1);
}

if (!hasCmd('wasm-pack') || !hasCmd('rustc')) {
  writeStub();
  process.exit(0);
}

const targetCheck = spawnSync(
  'rustup',
  ['target', 'list', '--installed'],
  { encoding: 'utf8', shell: true }
);
if (!String(targetCheck.stdout || '').includes('wasm32-unknown-unknown')) {
  console.log('[build-wasm] adding wasm32-unknown-unknown target…');
  spawnSync('rustup', ['target', 'add', 'wasm32-unknown-unknown'], {
    stdio: 'inherit',
    shell: true,
  });
}

fs.mkdirSync(outDir, { recursive: true });
const r = spawnSync(
  'wasm-pack',
  [
    'build',
    crateDir,
    '--target',
    'web',
    '--release',
    '--out-dir',
    outDir,
    '--out-name',
    'rcb_wasm_geom',
  ],
  { stdio: 'inherit', shell: true }
);

if (r.status !== 0) {
  console.warn('[build-wasm] wasm-pack failed — writing stub');
  writeStub();
  process.exit(0);
}

// wasm-pack writes pkg/.gitignore with `*` — keep artifacts for JS-only CI.
fs.writeFileSync(
  path.join(outDir, '.gitignore'),
  '# Keep built wasm for JS-only CI; rebuild via npm run build:wasm\n.*\n!.gitignore\n'
);

// Keep pkg README in sync with the crate (wasm-pack may overwrite with a stub).
const crateReadme = path.join(crateDir, 'README.md');
if (fs.existsSync(crateReadme)) {
  fs.copyFileSync(crateReadme, path.join(outDir, 'README.md'));
}

// Size budget (~349 KiB with opt-level=z); warn above 600 KiB raw.
const wasmPath = path.join(outDir, 'rcb_wasm_geom_bg.wasm');
if (fs.existsSync(wasmPath)) {
  const kb = fs.statSync(wasmPath).size / 1024;
  console.log(`[build-wasm] rcb_wasm_geom_bg.wasm = ${kb.toFixed(1)} KiB`);
  if (kb > 600) {
    console.warn('[build-wasm] WARNING: wasm exceeds 600 KiB raw — consider split crates / lazy load');
  }
}
