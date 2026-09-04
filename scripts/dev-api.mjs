import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveDevApiPort } from './dev-api-port.mjs';
import { apiRoot, loadApiDotEnv } from './load-api-env.mjs';

const repoRoot = path.resolve(apiRoot, '../..');
const win = process.platform === 'win32';
const venvPy = path.join(apiRoot, '.venv', win ? 'Scripts/python.exe' : 'bin/python');
const py = existsSync(venvPy) ? venvPy : 'python';
const devApiPort = resolveDevApiPort(process.env);

/** Local API — requires MySQL/Postgres ``DATABASE_URL`` in apps/api/.env. */
function devApiEnv() {
  // Prefer .env over a stale shell DATABASE_URL.
  const fileEnv = loadApiDotEnv();
  const env = { ...process.env, ...fileEnv, RECOMBYN_API_ROOT: apiRoot };
  const db = String(env.DATABASE_URL || '').trim();
  if (!db) {
    console.error(
      '[dev:api] DATABASE_URL is required (mysql://…). See apps/api/.env / docker compose.'
    );
    process.exit(1);
  }
  if (!/^mysql/i.test(db) && !/^postgres(ql)?:/i.test(db)) {
    console.error(
      '[dev:api] DATABASE_URL must be mysql://… or postgresql://…. See apps/api/.env / docker compose.'
    );
    process.exit(1);
  }
  return env;
}

if (!existsSync(venvPy)) {
  console.warn(
    `[dev:api] apps/api/.venv not found — using "${py}". Prefer: cd apps/api && python -m venv .venv && pip install -e ".[dev]"`
  );
}

// Drop stale listeners so Vite proxy and uvicorn stay on the same port.
spawnSync('npx', ['--yes', 'kill-port', String(devApiPort)], { stdio: 'ignore', shell: win });

const child = spawn(
  py,
  [
    '-m',
    'uvicorn',
    'app.main:app',
    '--reload',
    '--host',
    '127.0.0.1',
    '--port',
    String(devApiPort),
  ],
  { cwd: apiRoot, stdio: 'inherit', env: devApiEnv() }
);
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
