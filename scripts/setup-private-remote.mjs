#!/usr/bin/env node
/**
 * Configure git remotes for the private-dev → public-OSS workflow.
 *
 *   origin  → recombyn/recombyn-dev   (daily push target)
 *   public  → recombyn/zuoge (read-only OSS mirror)
 *
 * Usage: node scripts/setup-private-remote.mjs
 */

import { execSync } from 'node:child_process';

const PRIVATE = 'git@github.com:recombyn/recombyn-dev.git';
const PUBLIC = 'git@github.com:recombyn/zuoge.git';

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

function remoteUrl(name) {
  try {
    return execSync(`git remote get-url ${name}`, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const origin = remoteUrl('origin');
const pub = remoteUrl('public');

if (origin === PUBLIC) {
  console.log('[setup] origin currently points at public OSS — renaming to public remote');
  run('git remote rename origin public');
} else if (origin && origin !== PRIVATE) {
  console.warn(`[setup] unexpected origin: ${origin}`);
}

if (!remoteUrl('origin')) {
  run(`git remote add origin ${PRIVATE}`);
} else if (remoteUrl('origin') !== PRIVATE) {
  run(`git remote set-url origin ${PRIVATE}`);
}

if (!remoteUrl('public')) {
  run(`git remote add public ${PUBLIC}`);
} else if (remoteUrl('public') !== PUBLIC) {
  run(`git remote set-url public ${PUBLIC}`);
}

console.log('\nRemotes:');
run('git remote -v');
console.log('\nPush daily work to:  git push origin main');
console.log('OSS mirror updates:  GitHub Actions on recombyn-dev (sync-public.yml)');
