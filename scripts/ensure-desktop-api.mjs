/**
 * Ensure FastAPI is listening on 127.0.0.1:8000 for desktop **dev**.
 * Same stack as browser `dev:api` (apps/api/.env, MySQL etc.).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const win = process.platform === 'win32';
const HOST = '127.0.0.1';
const PORT = 8000;

function request(method, urlPath, { timeoutMs = 1200 } = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: HOST, port: PORT, path: urlPath, method, timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, body: '' });
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end();
  });
}

async function healthOk(timeoutMs = 800) {
  const res = await request('GET', '/api/v1/health', { timeoutMs });
  return res.status > 0 && res.status < 500;
}

function resolvePython() {
  const venvPy = path.join(apiRoot, '.venv', win ? 'Scripts/python.exe' : 'bin/python');
  if (existsSync(venvPy)) return venvPy;
  return win ? 'python' : 'python3';
}

function spawnDesktopApi() {
  const py = resolvePython();
  console.log(`[desktop] starting API via ${py} (cwd=${apiRoot})`);
  return spawn(py, ['-m', 'uvicorn', 'app.main:app', '--host', HOST, '--port', String(PORT)], {
    cwd: apiRoot,
    stdio: 'inherit',
    env: { ...process.env, RECOMBYN_API_ROOT: apiRoot },
    shell: false,
    detached: false,
    windowsHide: true,
  });
}

export async function ensureDesktopApi() {
  if (await healthOk()) {
    console.log(`[desktop] reusing API on http://${HOST}:${PORT} (same as browser)`);
    return { started: false, child: null };
  }

  const child = spawnDesktopApi();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`[desktop] API exited early (code ${child.exitCode})`);
    }
    if (await healthOk(1200)) {
      console.log(`[desktop] API ready at http://${HOST}:${PORT}`);
      return { started: true, child };
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  try {
    child.kill();
  } catch {
    /* ignore */
  }
  throw new Error('[desktop] timed out waiting for API health');
}

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  void (async () => {
    try {
      await ensureDesktopApi();
    } catch (err) {
      console.error(err?.message || err);
      process.exit(1);
    }
  })();
}
