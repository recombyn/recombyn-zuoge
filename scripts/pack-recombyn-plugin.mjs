#!/usr/bin/env node
/**
 * Pack a folder into ``*.recombyn-plugin`` (zip + plugin.json).
 *
 *   node scripts/pack-recombyn-plugin.mjs plugins/skills/festival_poster
 *   node scripts/pack-recombyn-plugin.mjs plugins/canvas/watermark --out dist/
 *   DESIGN_PLUGIN_HMAC_SECRET=... node scripts/pack-recombyn-plugin.mjs ... --sign
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function usage() {
  console.error(
    'Usage: node scripts/pack-recombyn-plugin.mjs <packDir> [--out dir] [--sign]'
  );
  process.exit(1);
}

const args = process.argv.slice(2);
if (!args.length || args.includes('-h') || args.includes('--help')) usage();

const packDirArg = args.find((a) => !a.startsWith('--'));
if (!packDirArg) usage();
const outIdx = args.indexOf('--out');
const outDir =
  outIdx >= 0 ? path.resolve(args[outIdx + 1] || '.') : path.join(root, 'dist', 'plugins');
const doSign = args.includes('--sign');

const packDir = path.resolve(root, packDirArg);
if (!fs.existsSync(packDir) || !fs.statSync(packDir).isDirectory()) {
  console.error('Not a directory:', packDir);
  process.exit(1);
}

const pluginJsonPath = path.join(packDir, 'plugin.json');
if (!fs.existsSync(pluginJsonPath)) {
  console.error('Missing plugin.json in', packDir);
  process.exit(1);
}
const meta = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
const id = String(meta.id || path.basename(packDir)).replace(/[^a-zA-Z0-9_-]+/g, '-');
const version = String(meta.version || '1.0.0');

fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${id}-${version}.recombyn-plugin`);

// Prefer system zip; fall back to PowerShell Compress-Archive on Windows.
const staging = fs.mkdtempSync(path.join(outDir, `.pack-${id}-`));
try {
  for (const name of fs.readdirSync(packDir)) {
    if (name === 'plugin.sig' || name === '.gitkeep') continue;
    const src = path.join(packDir, name);
    const dest = path.join(staging, name);
    fs.cpSync(src, dest, { recursive: true });
  }

  if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

  try {
    execFileSync('zip', ['-r', '-q', outFile, '.'], { cwd: staging, stdio: 'inherit' });
  } catch {
    // Windows: Compress-Archive creates .zip — rename after.
    const psZip = outFile + '.zip';
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${staging}\\*' -DestinationPath '${psZip}' -Force`,
      ],
      { stdio: 'inherit' }
    );
    fs.renameSync(psZip, outFile);
  }

  if (doSign) {
    const secret = (process.env.DESIGN_PLUGIN_HMAC_SECRET || '').trim();
    if (!secret) {
      console.error('DESIGN_PLUGIN_HMAC_SECRET required for --sign');
      process.exit(1);
    }
    // Call API helper via Python for identical digest rules.
    const py = path.join(root, 'apps', 'api', '.venv', 'Scripts', 'python.exe');
    const pyAlt = 'python';
    const code = `
from pathlib import Path
from app.services.design.plugins.pack_install import sign_plugin_zip_bytes
raw = Path(r'''${outFile.replace(/'/g, "''")}''').read_bytes()
signed = sign_plugin_zip_bytes(raw, secret=r'''${secret.replace(/'/g, "''")}''')
Path(r'''${outFile.replace(/'/g, "''")}''').write_bytes(signed)
print('signed')
`;
    const exe = fs.existsSync(py) ? py : pyAlt;
    execFileSync(
      exe,
      ['-c', code],
      { cwd: path.join(root, 'apps', 'api'), stdio: 'inherit', env: process.env }
    );
  }

  const size = fs.statSync(outFile).size;
  console.log(`Wrote ${outFile} (${size} bytes)`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
