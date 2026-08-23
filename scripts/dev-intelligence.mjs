import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const intelligenceRoot = path.join(root, 'src/commercial/intelligence');
const win = process.platform === 'win32';
const venvPy = path.join(intelligenceRoot, '.venv', win ? 'Scripts/python.exe' : 'bin/python');
const py = existsSync(venvPy) ? venvPy : 'python';

if (!existsSync(path.join(intelligenceRoot, 'src/recombyn_intelligence_service'))) {
  console.error(
    '[dev:intelligence] src/commercial/intelligence not found — install the Design Intelligence service tree.'
  );
  process.exit(1);
}

if (!existsSync(venvPy)) {
  console.warn(
    `[dev:intelligence] .venv missing — run: cd src/commercial/intelligence && python scripts/bootstrap_protocol.py`
  );
}

const env = {
  ...process.env,
  INTELLIGENCE_SERVICE_API_KEY: process.env.INTELLIGENCE_SERVICE_API_KEY || 'dev-key',
};

const child = spawn(
  py,
  [
    '-m',
    'uvicorn',
    'recombyn_intelligence_service.app:app',
    '--reload',
    '--host',
    '127.0.0.1',
    '--port',
    '8091',
  ],
  { cwd: intelligenceRoot, stdio: 'inherit', env, shell: win }
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
