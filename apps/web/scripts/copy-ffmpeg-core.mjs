/**
 * Copy `@ffmpeg/core` **esm** assets into `public/ffmpeg` for same-origin load.
 * Must be esm (not umd): the ffmpeg worker does `import(coreURL).default`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

function resolveCoreEsmDir() {
  try {
    const pkgJson = require.resolve('@ffmpeg/core/package.json');
    return path.join(path.dirname(pkgJson), 'dist', 'esm');
  } catch {
    const fallback = path.resolve(webRoot, '../../node_modules/@ffmpeg/core/dist/esm');
    if (fs.existsSync(path.join(fallback, 'ffmpeg-core.wasm'))) return fallback;
    throw new Error('@ffmpeg/core not found — run npm install first');
  }
}

const srcDir = resolveCoreEsmDir();
const destDir = path.join(webRoot, 'public', 'ffmpeg');
fs.mkdirSync(destDir, { recursive: true });

for (const name of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  const from = path.join(srcDir, name);
  const to = path.join(destDir, name);
  if (!fs.existsSync(from)) throw new Error(`missing ${from}`);
  fs.copyFileSync(from, to);
  console.log(`[copy-ffmpeg-core] ${name} → public/ffmpeg/ (esm)`);
}
