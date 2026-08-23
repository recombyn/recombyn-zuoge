#!/usr/bin/env node
/**
 * Post-rsync strip for recombyn-dev → recombyn OSS mirror.
 *
 * 1. Delete paths listed in src/commercial/oss-exclude.paths
 * 2. Overlay oss-stubs/ (OSS-safe replacements — no runtime commercial checks)
 * 3. Fail if any excluded tree still exists on the public copy
 */

import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pubRoot = process.argv[2] || path.join(repoRoot, 'pub');

if (!existsSync(pubRoot)) {
  console.error(`[sync-strip] public tree not found: ${pubRoot}`);
  process.exit(1);
}

const manifest = path.join(repoRoot, 'src/commercial/oss-exclude.paths');
const stubsRoot = path.join(repoRoot, 'oss-stubs');

function loadExcludePaths() {
  if (!existsSync(manifest)) {
    console.warn(`[sync-strip] no manifest at ${manifest}`);
    return [];
  }
  return readFileSync(manifest, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

function rmPub(rel) {
  const target = path.join(pubRoot, rel);
  if (!existsSync(target)) return;
  rmSync(target, { recursive: true, force: true });
  console.log(`[sync-strip] deleted ${rel}`);
}

const excluded = loadExcludePaths();
for (const rel of excluded) {
  rmPub(rel);
}

if (existsSync(stubsRoot)) {
  cpSync(stubsRoot, pubRoot, { recursive: true, force: true });
  console.log('[sync-strip] applied oss-stubs overlay');
}

const leftovers = excluded.filter((rel) => existsSync(path.join(pubRoot, rel)));
if (leftovers.length) {
  console.error('[sync-strip] excluded paths still present on public copy:');
  for (const rel of leftovers) console.error(`  - ${rel}`);
  process.exit(1);
}

if (existsSync(path.join(pubRoot, 'src/commercial'))) {
  console.error('[sync-strip] src/commercial must not exist on public mirror');
  process.exit(1);
}

let stubCount = 0;
if (existsSync(stubsRoot)) {
  const walk = (dir, prefix = '') => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      const rel = path.join(prefix, name).replace(/\\/g, '/');
      if (statSync(abs).isDirectory()) walk(abs, rel);
      else stubCount += 1;
    }
  };
  walk(stubsRoot);
}

console.log(`[sync-strip] ok — excluded ${excluded.length} path(s), ${stubCount} stub file(s) overlaid`);
