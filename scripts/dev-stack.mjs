/**
 * Local stack: API (8000) + Vite web (3000) + collab WS (1234).
 * When apps/intelligence exists, also starts Intelligence (8091).
 *
 *   npm run dev:stack
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const npm = win ? 'npm.cmd' : 'npm';
const intelligenceMarker = path.join(
  root,
  'apps/intelligence/src/recombyn_intelligence_service'
);
const hasIntelligence = existsSync(intelligenceMarker);

const children = [];

function run(name, args) {
  const child = spawn(npm, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: win,
  });
  child.on('exit', (code, signal) => {
    for (const c of children) {
      if (c !== child && !c.killed) c.kill('SIGTERM');
    }
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
  children.push(child);
  console.log(`[dev:stack] started ${name}`);
}

run('api', ['run', 'dev:api']);
run('web', ['run', 'dev', '--workspace=apps/web']);
run('collab', ['run', 'dev', '--workspace=apps/collab']);
if (hasIntelligence) {
  run('intelligence', ['run', 'dev:intelligence']);
} else {
  console.log('[dev:stack] skip intelligence (apps/intelligence missing)');
}

function shutdown() {
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM');
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
