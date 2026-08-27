#!/usr/bin/env node
/**
 * Post-rsync strip for recombyn-dev → recombyn OSS mirror.
 *
 * 1. Delete paths listed in scripts/oss-exclude.paths
 * 2. Overlay scripts/oss-stubs/ (OSS-safe replacements — no runtime commercial checks)
 * 3. Fail if any excluded tree still exists on the public copy
 */

import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pubRoot = process.argv[2] || path.join(repoRoot, 'pub');

if (!existsSync(pubRoot)) {
  console.error(`[sync-strip] public tree not found: ${pubRoot}`);
  process.exit(1);
}

const manifest = path.join(repoRoot, 'scripts/oss-exclude.paths');
const stubsRoot = path.join(repoRoot, 'scripts/oss-stubs');

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
  console.log('[sync-strip] applied scripts/oss-stubs overlay');
}

const leftovers = excluded.filter((rel) => existsSync(path.join(pubRoot, rel)));
if (leftovers.length) {
  console.error('[sync-strip] excluded paths still present on public copy:');
  for (const rel of leftovers) console.error(`  - ${rel}`);
  process.exit(1);
}

for (const rel of ['apps/intelligence', 'apps/web/src/commercial/mockup', 'docs/commercial']) {
  if (existsSync(path.join(pubRoot, rel))) {
    console.error(`[sync-strip] ${rel} must not exist on public mirror`);
    process.exit(1);
  }
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

/** Public mirror: no heavy auto CI on push (private CI already covers). Keep the
 *  lightweight required PR gate (block-cursor-coauthor) so zuoge rulesets can merge. */
function disablePublicAutoCi() {
  const wfDir = path.join(pubRoot, '.github', 'workflows');
  if (!existsSync(wfDir)) return;
  const keepAuto = new Set(['block-cursor-coauthor.yml']);
  let n = 0;
  for (const name of readdirSync(wfDir)) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
    if (keepAuto.has(name)) continue;
    const fp = path.join(wfDir, name);
    if (!statSync(fp).isFile()) continue;
    let text = readFileSync(fp, 'utf8');
    const next = text.replace(/^on:\r?\n[\s\S]*?(?=^jobs:)/m, 'on:\n  workflow_dispatch:\n\n');
    if (next !== text) {
      writeFileSync(fp, next, 'utf8');
      n += 1;
    }
  }
  if (n) console.log(`[sync-strip] set ${n} public workflow(s) to workflow_dispatch only`);
}

disablePublicAutoCi();
