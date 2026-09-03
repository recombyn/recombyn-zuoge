/**
 * Local stack: API (8000) + Vite web (3000) + collab WS (1234).
 *
 *   npm run dev:stack
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const npm = win ? 'npm.cmd' : 'npm';

const kids = [
  spawn(npm, ['run', 'dev:api'], { cwd: root, stdio: 'inherit', shell: win }),
  spawn(npm, ['run', 'dev:web'], { cwd: root, stdio: 'inherit', shell: win }),
  spawn(npm, ['run', 'dev:collab'], { cwd: root, stdio: 'inherit', shell: win }),
];

function shutdown() {
  for (const child of kids) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

for (const child of kids) {
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[dev:stack] child exited ${code}`);
      shutdown();
    }
  });
}
