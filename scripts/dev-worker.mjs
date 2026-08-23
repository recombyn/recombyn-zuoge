/**
 * Celery worker for async jobs (import, hydrate, …).
 *
 *   npm run dev:worker
 *
 * Requires Redis (docker compose up -d redis) and apps/api deps installed.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/api');
const win = process.platform === 'win32';
const venvPy = path.join(apiRoot, '.venv', win ? 'Scripts/python.exe' : 'bin/python');
const py = existsSync(venvPy) ? venvPy : 'python';

if (!existsSync(venvPy)) {
  console.warn(
    `[dev:worker] apps/api/.venv not found — using "${py}". Prefer: npm run install:api`
  );
}

const args = ['-m', 'celery', '-A', 'worker.celery_app.celery', 'worker', '-l', 'info', '--concurrency=1'];
if (win) args.push('--pool=solo');

console.log(`[dev:worker] ${py} ${args.join(' ')}`);
const child = spawn(py, args, { cwd: apiRoot, stdio: 'inherit', env: process.env });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
