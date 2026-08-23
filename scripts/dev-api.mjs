import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Local web dev: avoid hanging on remote MySQL in apps/api/.env unless opted in. */
function devApiEnv() {
  const env = { ...process.env, RECOMBYN_API_ROOT: apiRoot };
  const useRemote =
    String(env.USE_REMOTE_DB || '').trim() === '1' ||
    String(env.USE_REMOTE_DB || '').toLowerCase() === 'true';
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

const child = spawn(
  py,
  ['-m', 'uvicorn', 'app.main:app', '--reload', '--host', '127.0.0.1', '--port', '8000'],
  { cwd: apiRoot, stdio: 'inherit', env: devApiEnv() }
);
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
