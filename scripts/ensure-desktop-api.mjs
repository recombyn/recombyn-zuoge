/**
 * Ensure FastAPI is listening on 127.0.0.1:8000 for desktop **dev**.
 *
 * - local: SQLite + DESKTOP_LOCAL_AUTO_LOGIN (BYOK offline)
 * - cloud: reuse / spawn with apps/api/.env as-is (MySQL etc.) — same as browser `dev:api`
 *          (no SQLite rewrite, no auto-login). Public host is optional via VITE_API_BASE_URL.
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
const sqliteRel = path.join('storage', 'recombyn.db').replace(/\\/g, '/');

function request(method, urlPath, { timeoutMs = 1200, body } = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: urlPath,
        method,
        timeout: timeoutMs,
        headers: body
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
          : undefined,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, body: '' });
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    if (body) req.write(body);
    req.end();
  });
}

async function healthOk(timeoutMs = 800) {
  const res = await request('GET', '/api/v1/health', { timeoutMs });
  return res.status > 0 && res.status < 500;
}

/** Probe POST /auth/desktop-local — 200 only when DESKTOP_LOCAL_AUTO_LOGIN is on. */
async function probeDesktopLocalLogin(timeoutMs = 2500) {
  return request('POST', '/api/v1/auth/desktop-local', {
    timeoutMs,
    body: '{}',
  });
}

function resolvePython() {
  const venvPy = path.join(apiRoot, '.venv', win ? 'Scripts/python.exe' : 'bin/python');
  if (existsSync(venvPy)) return venvPy;
  return win ? 'python' : 'python3';
}

function desktopApiEnv(flavor) {
  if (flavor === 'local') {
    // Offline BYOK — force SQLite; empty DATABASE_URL can fall through to MySQL on Windows.
    return {
      ...process.env,
      DATABASE_URL: `sqlite:///${sqliteRel}`,
      SQLITE_DB_PATH: sqliteRel,
      DESKTOP_LOCAL_AUTO_LOGIN: 'true',
      S3_ENABLED: 'false',
      RECOMBYN_API_ROOT: apiRoot,
    };
  }
  // Cloud desktop: same process env / apps/api/.env as browser `npm run dev:api`.
  return {
    ...process.env,
    DESKTOP_LOCAL_AUTO_LOGIN: 'false',
    RECOMBYN_API_ROOT: apiRoot,
  };
}

function spawnDesktopApi(flavor) {
  const py = resolvePython();
  console.log(`[desktop:${flavor}] starting API via ${py} (cwd=${apiRoot})`);
  return spawn(py, ['-m', 'uvicorn', 'app.main:app', '--host', HOST, '--port', String(PORT)], {
    cwd: apiRoot,
    stdio: 'inherit',
    env: desktopApiEnv(flavor),
    shell: false,
    detached: false,
    windowsHide: true,
  });
}

function formatProbeFailure(res) {
  if (res.status === 404) {
    return (
      'desktop-local login disabled (set DESKTOP_LOCAL_AUTO_LOGIN=true) ' +
      `or stale API without the route — body=${res.body.slice(0, 200)}`
    );
  }
  if (res.status === 500) {
    return (
      'desktop-local login crashed (often stale SQLite schema). ' +
      'Restart after pulling migrations, or delete apps/api/storage/recombyn.db and retry. ' +
      `body=${res.body.slice(0, 200)}`
    );
  }
  if (res.status === 403) {
    return 'desktop-local rejected non-loopback client';
  }
  return `desktop-local probe HTTP ${res.status} body=${res.body.slice(0, 200)}`;
}

/**
 * @param {{ flavor?: 'local' | 'cloud' }} [opts]
 */
export async function ensureDesktopApi(opts = {}) {
  const flavor = opts.flavor === 'cloud' ? 'cloud' : 'local';

  if (await healthOk()) {
    const probe = await probeDesktopLocalLogin();
    if (flavor === 'local') {
      if (probe.status === 200) {
        console.log(`[desktop:local] API already on http://${HOST}:${PORT} (auto-login ok)`);
        return { started: false, child: null };
      }
      throw new Error(
        `[desktop:local] something already listens on :${PORT} but auto-login failed — ` +
          `${formatProbeFailure(probe)}. Stop that API and re-run npm run dev:desktop.`
      );
    }
    // Cloud: refuse a BYOK-only auto-login API (wrong catalog / empty SQLite).
    if (probe.status === 200) {
      throw new Error(
        `[desktop:cloud] :${PORT} is running desktop-local auto-login API (BYOK-only). ` +
          'Stop it (`npm run dev:desktop` / process on 8000) and re-run npm run dev:desktop:cloud ' +
          '(or `npm run dev:api` for the same MySQL/.env stack as the browser).'
      );
    }
    console.log(`[desktop:cloud] reusing API on http://${HOST}:${PORT} (same as browser)`);
    return { started: false, child: null };
  }

  const child = spawnDesktopApi(flavor);

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`[desktop:${flavor}] API exited early (code ${child.exitCode})`);
    }
    if (await healthOk(1200)) {
      if (flavor === 'local') {
        const probe = await probeDesktopLocalLogin();
        if (probe.status !== 200) {
          try {
            child.kill();
          } catch {
            /* ignore */
          }
          throw new Error(`[desktop:local] API came up but ${formatProbeFailure(probe)}`);
        }
      }
      console.log(`[desktop:${flavor}] API ready at http://${HOST}:${PORT}`);
      return { started: true, child };
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  try {
    child.kill();
  } catch {
    /* ignore */
  }
  throw new Error(`[desktop:${flavor}] timed out waiting for API health`);
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
