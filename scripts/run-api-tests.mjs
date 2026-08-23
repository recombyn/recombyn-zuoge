/**
 * Run API pytest with apps/api/.venv when present (Windows-safe).
 *
 *   node scripts/run-api-tests.mjs
 *   node scripts/run-api-tests.mjs tests/unit_tests -q
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = path.join(root, 'apps/api');
const win = process.platform === 'win32';
const venvPy = path.join(apiRoot, '.venv', win ? 'Scripts/python.exe' : 'bin/python');
const py = existsSync(venvPy) ? venvPy : 'python';

if (!existsSync(venvPy)) {
  console.warn(
    `[test:api] apps/api/.venv not found — using "${py}". Prefer: npm run install:api`
  );
}

const extra = process.argv.slice(2);
const args = ['-m', 'pytest', ...(extra.length ? extra : ['tests'])];
const child = spawn(py, args, { cwd: apiRoot, stdio: 'inherit', env: process.env });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
