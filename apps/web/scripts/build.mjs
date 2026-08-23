/**
 * Cross-platform web build for Tauri / CI.
 * Runs `tsc` for visibility but never fails the build on type errors
 * (Windows cmd has no `true`, so `tsc || true && vite` breaks there).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const npmExec = win ? 'npx.cmd' : 'npx';

function run(args) {
  return spawnSync(npmExec, args, {
    cwd: webRoot,
    stdio: 'inherit',
    shell: win,
    env: process.env,
  });
}

const tsc = run(['tsc', '--pretty', 'false']);
if (tsc.status !== 0) {
  console.warn(
    `[build] tsc exited ${tsc.status ?? 'unknown'} — continuing with vite build (type errors are non-blocking).`
  );
}

const vite = run(['vite', 'build', ...process.argv.slice(2)]);
process.exit(vite.status ?? 1);
