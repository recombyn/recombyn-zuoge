/**
 * Local full stack: Vite web (3000) + collab WS (1234) + API (8000).
 *
 *   npm run dev:full
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const npm = win ? 'npm.cmd' : 'npm';

const children = [];

function run(name, command, args, opts = {}) {
  const child = spawn(command, args, {
    cwd: opts.cwd || root,
    stdio: 'inherit',
    env: { ...process.env, ...opts.env },
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
  console.log(`[dev:full] started ${name}`);
}

run('web', npm, ['run', 'dev', '--workspace=apps/web']);
run('collab', npm, ['run', 'dev', '--workspace=apps/collab']);
run('api', npm, ['run', 'dev:api']);

console.log('');
console.log('[dev:full] URLs');
console.log('  web          http://localhost:3000');
console.log('  api          http://localhost:8000/docs');
console.log('  collab ws    ws://localhost:1234');
console.log('');

function shutdown() {
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM');
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
