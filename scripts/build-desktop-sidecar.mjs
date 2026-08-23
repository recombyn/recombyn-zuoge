/**
 * Build the local-desktop API sidecar with PyInstaller and stage it for Tauri:
 *   apps/web/src-tauri/sidecars/recombyn-api/recombyn-api(.exe) + _internal/
 *
 * Requires: apps/api/.venv with `pip install -e ".[dev]" pyinstaller`
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const outDir = path.join(repoRoot, 'apps', 'web', 'src-tauri', 'sidecars', 'recombyn-api');
const win = process.platform === 'win32';
const exeName = win ? 'recombyn-api.exe' : 'recombyn-api';

const venvPy = path.join(apiRoot, '.venv', win ? 'Scripts/python.exe' : 'bin/python');
const py = existsSync(venvPy) ? venvPy : win ? 'python' : 'python3';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || apiRoot,
    stdio: 'inherit',
    env: process.env,
    shell: win,
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (code ${r.status})`);
  }
}

function main() {
  if (!existsSync(path.join(apiRoot, 'app', 'main.py'))) {
    throw new Error(`API not found at ${apiRoot}`);
  }

  console.log(`[sidecar] python=${py}`);
  // Ensure PyInstaller is available.
  const check = spawnSync(py, ['-c', 'import PyInstaller'], {
    cwd: apiRoot,
    encoding: 'utf8',
    shell: win,
  });
  if (check.status !== 0) {
    console.log('[sidecar] installing pyinstaller into venv…');
    run(py, ['-m', 'pip', 'install', 'pyinstaller>=6.0']);
  }

  const work = path.join(apiRoot, 'build', 'desktop-sidecar');
  const dist = path.join(work, 'dist');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const entry = path.join(apiRoot, 'scripts', 'desktop_sidecar_main.py');
  const sep = win ? ';' : ':';
  // Absolute sources — PyInstaller resolves --add-data relative to the spec dir otherwise.
  const addData = [
    `${path.join(apiRoot, 'seeds')}${sep}seeds`,
    `${path.join(apiRoot, 'alembic.ini')}${sep}.`,
    `${path.join(apiRoot, 'app', 'alembic')}${sep}app/alembic`,
  ];

  const args = [
    '-m',
    'PyInstaller',
    '--noconfirm',
    '--clean',
    '--onedir',
    '--name',
    'recombyn-api',
    '--distpath',
    dist,
    '--workpath',
    path.join(work, 'work'),
    '--specpath',
    work,
    '--paths',
    apiRoot,
    // Collect FastAPI / uvicorn / pydantic runtime bits.
    '--collect-all',
    'uvicorn',
    '--collect-all',
    'fastapi',
    '--collect-all',
    'starlette',
    '--collect-all',
    'pydantic',
    '--collect-all',
    'sqlmodel',
    '--collect-all',
    'alembic',
    '--hidden-import',
    'app.main',
    '--hidden-import',
    'pymysql',
    '--hidden-import',
    'multipart',
    ...addData.flatMap((d) => ['--add-data', d]),
    entry,
  ];

  console.log('[sidecar] running PyInstaller (this can take several minutes)…');
  run(py, args, { cwd: apiRoot });

  const builtDir = path.join(dist, 'recombyn-api');
  const builtExe = path.join(builtDir, exeName);
  if (!existsSync(builtExe)) {
    throw new Error(`PyInstaller output missing: ${builtExe}`);
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(path.dirname(outDir), { recursive: true });
  cpSync(builtDir, outDir, { recursive: true });

  // Marker for Tauri / docs.
  writeFileSync(
    path.join(outDir, '.sidecar-built'),
    `${new Date().toISOString()}\nhost=${os.platform()}-${os.arch()}\n`,
    'utf8'
  );

  console.log(`[sidecar] staged → ${outDir}`);
  console.log(`[sidecar] exe → ${path.join(outDir, exeName)}`);
}

try {
  main();
} catch (err) {
  console.error('[sidecar]', err?.message || err);
  process.exit(1);
}
