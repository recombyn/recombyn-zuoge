import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const intelligenceRoot = path.join(root, 'apps/intelligence');
const win = process.platform === 'win32';
const venvPy = path.join(intelligenceRoot, '.venv', win ? 'Scripts/python.exe' : 'bin/python');
const py = existsSync(venvPy) ? venvPy : 'python';

if (!existsSync(path.join(intelligenceRoot, 'src/recombyn_intelligence_service'))) {
  console.error(
    '[dev:intelligence] apps/intelligence not found — install the Design Intelligence service tree.'
  );
  process.exit(1);
}

if (!existsSync(venvPy)) {
  console.warn(
    `[dev:intelligence] .venv missing — run: cd apps/intelligence && python scripts/bootstrap_protocol.py`
  );
}

const env = {
  ...process.env,
  INTELLIGENCE_SERVICE_API_KEY: process.env.INTELLIGENCE_SERVICE_API_KEY || 'dev-key',
  PYTHONPATH: [path.join(intelligenceRoot, 'src'), process.env.PYTHONPATH || '']
    .filter(Boolean)
    .join(path.delimiter),
};

// Windows: skip --reload (orphan spawn workers can ghost-listen on :8091).
const args = [
  '-m',
  'uvicorn',
  'recombyn_intelligence_service.app:app',
  '--host',
  '127.0.0.1',
  '--port',
  '8091',
];
if (!win || process.env.ILP_RELOAD === '1') args.push('--reload');

console.log(`[dev:intelligence] ${py} ${args.join(' ')}`);
const child = spawn(py, args, { cwd: intelligenceRoot, stdio: 'inherit', env, shell: win });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
