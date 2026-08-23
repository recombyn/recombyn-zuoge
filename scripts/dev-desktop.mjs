import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDesktopApi } from './ensure-desktop-api.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(repoRoot, 'apps', 'web');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const win = process.platform === 'win32';
const sidecarExe = path.join(
  webRoot,
  'src-tauri',
  'sidecars',
  'recombyn-api',
  win ? 'recombyn-api.exe' : 'recombyn-api'
);

/** argv: [build?] [cloud?] [sidecar-only?] */
const args = process.argv.slice(2).map((a) => a.toLowerCase());
const isBuild = args.includes('build');
const isCloud = args.includes('cloud');
const sidecarOnly = args.includes('sidecar');
const desktopMode = isCloud ? 'cloud' : 'local';

function buildSidecar() {
  console.log('[dev:desktop] building API sidecar (PyInstaller)…');
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'build-desktop-sidecar.mjs')], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error('build-desktop-sidecar failed');
  }
}

if (sidecarOnly) {
  try {
    buildSidecar();
    process.exit(0);
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  }
}

const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
const cargoExe = path.join(cargoBin, win ? 'cargo.exe' : 'cargo');

if (!existsSync(cargoExe)) {
  console.error(
    '[dev:desktop] Rust toolchain not found (cargo missing).\n' +
      '  Install: https://rustup.rs\n' +
      `  Expected: ${cargoExe}`
  );
  process.exit(1);
}

const pathKey = win ? 'Path' : 'PATH';
const prev = process.env[pathKey] || process.env.PATH || '';

const env = {
  ...process.env,
  [pathKey]: `${cargoBin}${path.delimiter}${prev}`,
  RECOMBYN_DESKTOP_MODE: desktopMode,
  RECOMBYN_API_ROOT: apiRoot,
  VITE_DESKTOP_MODE: desktopMode,
};

// Optional hosted override only (no default public host — recombyn.com is not assumed deployed).
// Cloud/browser both use relative `/api` → Vite proxy → local :8000 when unset.
if (process.env.VITE_API_BASE_URL) {
  env.VITE_API_BASE_URL = String(process.env.VITE_API_BASE_URL).replace(/\/$/, '');
} else {
  delete env.VITE_API_BASE_URL;
}

let apiChild = null;

async function main() {
  console.log(`[dev:desktop] flavor=${desktopMode}${isBuild ? ' (build)' : ' (dev)'}`);
  if (desktopMode === 'cloud') {
    console.log(
      `[dev:desktop] API=${env.VITE_API_BASE_URL || 'relative /api → Vite proxy → :8000 (same as browser)'}`
    );
  }

  if (desktopMode === 'local' && isBuild) {
    const force = args.includes('rebuild-sidecar') || process.env.RECOMBYN_REBUILD_SIDECAR === '1';
    if (force || !existsSync(sidecarExe)) {
      buildSidecar();
    } else {
      console.log(`[dev:desktop] reusing sidecar at ${sidecarExe}`);
    }
  }

  if (!isBuild) {
    // local → SQLite auto-login; cloud → apps/api/.env stack (same as browser), never SQLite rewrite.
    try {
      const res = await ensureDesktopApi({ flavor: desktopMode });
      apiChild = res.child;
    } catch (err) {
      console.error(err?.message || err);
      console.error(
        '[dev:desktop] Install API deps: cd apps/api && python -m venv .venv && pip install -e ".[dev]"'
      );
      process.exit(1);
    }
  }

  const npmCmd = win ? 'npm.cmd' : 'npm';
  const script = isBuild ? 'tauri:build' : 'tauri:dev';
  const npmArgs = ['run', script];
  if (desktopMode === 'cloud') {
    npmArgs.push('--', '--config', 'src-tauri/tauri.cloud.conf.json');
  } else if (isBuild) {
    npmArgs.push('--', '--config', 'src-tauri/tauri.local.conf.json');
  }

  const child = spawn(npmCmd, npmArgs, {
    cwd: webRoot,
    stdio: 'inherit',
    env,
    shell: win,
  });

  const shutdown = () => {
    if (apiChild && apiChild.exitCode == null) {
      try {
        apiChild.kill();
      } catch {
        /* ignore */
      }
    }
  };

  child.on('exit', (code, signal) => {
    shutdown();
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });

  process.on('SIGINT', () => {
    shutdown();
    child.kill('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown();
    child.kill('SIGTERM');
  });
}

void (async () => {
  try {
    await main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
