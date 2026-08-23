#!/usr/bin/env node
/**
 * Bootstrap a fresh public recombyn/recombyn mirror (single commit, one contributor).
 *
 * Prereqs:
 *   1. Delete the old github.com/recombyn/recombyn repo (Settings → Danger zone).
 *   2. Create an empty public repo named "recombyn" under the recombyn account.
 *   3. PAT with repo scope on the new public repo (reuse PUBLIC_REPO_TOKEN).
 *
 * Usage (from repo root):
 *   node scripts/bootstrap-public-repo.mjs
 *   node scripts/bootstrap-public-repo.mjs --push   # also force-push to origin public remote
 */

import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pubDir = path.join(root, 'pub-bootstrap');
const doPush = process.argv.includes('--push');

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: opts.cwd ?? root, ...opts });
}

if (existsSync(pubDir)) rmSync(pubDir, { recursive: true, force: true });

run(
  `robocopy "${root}" "${pubDir}" /E /XD .git pub pub-bootstrap pub-test node_modules /NFL /NDL /NJH /NJS /nc /ns /np`,
  { shell: true }
);

run(`node scripts/sync-public-strip.mjs "${pubDir}"`);

run('git init -b main', { cwd: pubDir });
run('git config user.name "recombyn"', { cwd: pubDir });
run('git config user.email "51704449+recombyn@users.noreply.github.com"', { cwd: pubDir });
run('git add -A', { cwd: pubDir });
run('git commit -m "chore: initial public mirror"', { cwd: pubDir });

console.log('\n[bootstrap] Public tree ready at pub-bootstrap/ (single commit, author=recombyn).');

if (doPush) {
  const remote = execSync('git remote get-url public', { encoding: 'utf8' }).trim();
  run(`git remote add origin ${JSON.stringify(remote).slice(1, -1)}`, { cwd: pubDir });
  run('git push -u origin main --force', { cwd: pubDir });
  console.log('[bootstrap] Force-pushed to public remote.');
} else {
  console.log('To publish: cd pub-bootstrap && git remote add origin <public-url> && git push -u origin main --force');
}
