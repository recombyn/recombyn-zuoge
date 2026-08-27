import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveDevApiPort } from './dev-api-port.mjs';
import { apiRoot, loadApiDotEnv } from './load-api-env.mjs';

const repoRoot = path.resolve(apiRoot, '../..');
const intelligenceMarker = path.join(
  repoRoot,
  'apps/intelligence/src/recombyn_intelligence_service'
);
const win = process.platform === 'win32';
const venvPy = path.join(apiRoot, '.venv', win ? 'Scripts/python.exe' : 'bin/python');
const py = existsSync(venvPy) ? venvPy : 'python';
const sqliteRel = path.join('storage', 'recombyn.db').replace(/\\/g, '/');
const devApiPort = resolveDevApiPort(process.env);

/** Local web dev: default SQLite unless apps/api/.env sets DATABASE_URL or USE_REMOTE_DB=1. */
function devApiEnv() {
  const fileEnv = loadApiDotEnv();
  const env = { ...process.env, ...fileEnv, RECOMBYN_API_ROOT: apiRoot };
  const useRemote =
    String(env.USE_REMOTE_DB || '').trim() === '1' ||
    String(env.USE_REMOTE_DB || '').toLowerCase() === 'true' ||
    Boolean(String(env.DATABASE_URL || '').trim());
  if (!useRemote) {
    env.DATABASE_URL = `sqlite:///${sqliteRel}`;
    env.SQLITE_DB_PATH = sqliteRel;
  }
  if (existsSync(intelligenceMarker) && !String(env.RECOMBYN_INTELLIGENCE_URL || '').trim()) {
    env.RECOMBYN_INTELLIGENCE_MODE = env.RECOMBYN_INTELLIGENCE_MODE || 'cloud';
    env.RECOMBYN_INTELLIGENCE_URL = 'http://127.0.0.1:8091';
    env.RECOMBYN_INTELLIGENCE_API_KEY = env.RECOMBYN_INTELLIGENCE_API_KEY || 'dev-key';
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
