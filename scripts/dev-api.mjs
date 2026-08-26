import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDevApiPort } from './dev-api-port.mjs';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/api');
const repoRoot = path.resolve(apiRoot, '../..');
const intelligenceMarker = path.join(
  repoRoot,
  'src/commercial/intelligence/src/recombyn_intelligence_service'
);
const win = process.platform === 'win32';
const venvPy = path.join(apiRoot, '.venv', win ? 'Scripts/python.exe' : 'bin/python');
const py = existsSync(venvPy) ? venvPy : 'python';
const sqliteRel = path.join('storage', 'recombyn.db').replace(/\\/g, '/');
const devApiPort = resolveDevApiPort(process.env);

function loadApiDotEnv() {
  const envPath = path.join(apiRoot, '.env');
  if (!existsSync(envPath)) return {};
  const out = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

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
