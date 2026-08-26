#!/usr/bin/env node
/**
 * Rebuild recombyn/zuoge from scratch: orphan branch + one OSS snapshot commit.
 *
 * Usage:
 *   node scripts/rebuild-public-mirror.mjs [--dry-run] [--out DIR]
 *
 * Env:
 *   PUBLIC_REPO         default recombyn/zuoge
 *   REBUILD_PUSH=1      force-push orphan main (needs admin bypass on zuoge)
 *   GITHUB_TOKEN / GH_TOKEN — PAT with repo write on public mirror
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const outIdx = process.argv.indexOf('--out');
const outRoot =
  outIdx >= 0
    ? path.resolve(process.argv[outIdx + 1])
    : path.join(process.env.TEMP || process.env.TMP || repoRoot, 'recombyn-pub-rebuild');
const publicRepo = process.env.PUBLIC_REPO || 'recombyn/zuoge';
const shouldPush = process.env.REBUILD_PUSH === '1' && !dryRun;

const RSYNC_EXCLUDES = [
  '.git/',
  'node_modules/',
  '**/.venv/',
  '**/__pycache__/',
  '**/.pytest_cache/',
  '**/dist/',
  '**/.next/',
  '**/build/',
  '**/.turbo/',
  'pub/',
  'pub-test/',
  '.pub-rebuild/',
  'apps/web/src-tauri/target/',
  '**/target/',
];

function rimrafSafe(dir) {
  if (!existsSync(dir)) return;
  if (process.platform === 'win32') {
    spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', dir], { stdio: 'ignore' });
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } else {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: opts.quiet ? 'pipe' : 'inherit',
    cwd: opts.cwd,
    shell: process.platform === 'win32',
    env: { ...process.env, ...opts.env },
  });
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || '').trim();
    throw new Error(`${cmd} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return (res.stdout || '').trim();
}

function copyTreeWindows(src, dest) {
  mkdirSync(dest, { recursive: true });
  // robocopy: exit 0-7 = success
  const res = spawnSync(
    'robocopy',
    [src, dest, '/MIR', '/XD', 'node_modules', '.git', 'pub', 'pub-test', '.pub-rebuild', '.venv', '.turbo', '.pytest_cache', 'target'],
    { shell: true, stdio: 'inherit' }
  );
  const code = res.status ?? 1;
  if (code >= 8) throw new Error(`robocopy failed with code ${code}`);
}

function copyTreeUnix(src, dest) {
  const excludes = RSYNC_EXCLUDES.flatMap((x) => ['--exclude', x]);
  run('rsync', ['-a', '--delete', ...excludes, `${src}/`, `${dest}/`]);
}

function buildCommitMessage() {
  const subject = run('git', ['log', '-1', '--format=%s'], { cwd: repoRoot, quiet: true });
  const body = run('git', ['log', '-1', '--format=%b'], { cwd: repoRoot, quiet: true });
  const sha = run('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, quiet: true });
  const lines = [subject];
  if (body.trim()) lines.push('', body.trim());
  lines.push('', `Sync-source: recombyn-dev@${sha}`);
  return lines.join('\n');
}

function main() {
  console.log(`[rebuild] source=${repoRoot}`);
  console.log(`[rebuild] out=${outRoot} dryRun=${dryRun} push=${shouldPush}`);

  if (existsSync(outRoot)) rimrafSafe(outRoot);
  mkdirSync(outRoot, { recursive: true });

  if (process.platform === 'win32') {
    copyTreeWindows(repoRoot, outRoot);
  } else {
    copyTreeUnix(repoRoot, outRoot);
  }

  run('node', ['scripts/sync-public-strip.mjs', outRoot], { cwd: repoRoot });

  const msg = buildCommitMessage();
  const msgFile = path.join(outRoot, '.rebuild-commit-msg.txt');
  writeFileSync(msgFile, msg, 'utf8');

  if (dryRun) {
    console.log('[rebuild] dry-run — commit message preview:\n');
    console.log(msg);
    console.log(`\n[rebuild] stripped tree at ${outRoot}`);
    return;
  }

  run('git', ['init', '-b', 'main'], { cwd: outRoot });
  run('git', ['config', 'user.name', 'recombyn'], { cwd: outRoot });
  run('git', ['config', 'user.email', '51704449+recombyn@users.noreply.github.com'], {
    cwd: outRoot,
  });
  run('git', ['add', '-A'], { cwd: outRoot });
  run('git', ['commit', '-F', msgFile], { cwd: outRoot });
  try {
    rmSync(msgFile, { force: true });
  } catch {
    /* ignore */
  }

  const newSha = run('git', ['rev-parse', 'HEAD'], { cwd: outRoot, quiet: true });
  console.log(`[rebuild] new commit ${newSha.slice(0, 7)}`);

  if (!shouldPush) {
    console.log('[rebuild] done (local only). Set REBUILD_PUSH=1 to force-push.');
    return;
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('REBUILD_PUSH=1 requires GITHUB_TOKEN or GH_TOKEN');

  const remote = `https://x-access-token:${token}@github.com/${publicRepo}.git`;
  run('git', ['remote', 'add', 'origin', remote], { cwd: outRoot });

  // Backup tag on remote before overwrite (best-effort).
  try {
    run('git', ['fetch', 'origin', 'main'], { cwd: outRoot, quiet: true });
    const oldSha = run('git', ['rev-parse', 'origin/main'], { cwd: outRoot, quiet: true });
    const tag = `archive/pre-rebuild-${new Date().toISOString().slice(0, 10)}`;
    run('git', ['push', 'origin', `${oldSha}:refs/tags/${tag}`], { cwd: outRoot, quiet: true });
    console.log(`[rebuild] tagged old main as ${tag}`);
  } catch {
    console.warn('[rebuild] could not tag old main (continuing)');
  }

  run('git', ['push', '--force', 'origin', 'main'], { cwd: outRoot });
  console.log(`[rebuild] force-pushed ${publicRepo} main`);
}

main();
