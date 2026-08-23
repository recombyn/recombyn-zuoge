/**
 * Dump FastAPI OpenAPI → openapi/api-openapi.json (paths stripped of /api/v1
 * so OpenAPILink base URL can be `…/api/v1`).
 *
 * Prefer a running API (`http://127.0.0.1:8000/api/v1/openapi.json`).
 * Fallback: import `app.main:app` if PYTHONPATH / venv is set up.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'openapi');
const outFile = path.join(outDir, 'api-openapi.json');
const API_PREFIX = '/api/v1';

const openapiUrl =
  process.env.OPENAPI_URL?.trim() || 'http://127.0.0.1:8000/api/v1/openapi.json';

function stripApiPrefix(spec) {
  const paths = spec.paths || {};
  const next = {};
  for (const [route, item] of Object.entries(paths)) {
    let key = route;
    if (key === API_PREFIX || key === `${API_PREFIX}/`) key = '/';
    else if (key.startsWith(`${API_PREFIX}/`)) key = key.slice(API_PREFIX.length) || '/';
    next[key] = item;
  }
  spec.paths = next;
  if (Array.isArray(spec.servers)) {
    spec.servers = spec.servers.map((s) => {
      if (!s?.url) return s;
      const url = String(s.url).replace(/\/$/, '');
      if (url.endsWith(API_PREFIX)) {
        return { ...s, url: url.slice(0, -API_PREFIX.length) || '/' };
      }
      return s;
    });
  }
  return spec;
}

async function fetchSpec() {
  const res = await fetch(openapiUrl);
  if (!res.ok) throw new Error(`GET ${openapiUrl} → ${res.status}`);
  return res.json();
}

function exportViaPython() {
  const apiRoot = path.resolve(root, '../../apps/api');
  const py = process.env.PYTHON || 'python';
  const tmpOut = path.join(outDir, '_raw-openapi.json');
  fs.mkdirSync(outDir, { recursive: true });
  const code = `
import json, sys, logging
logging.disable(logging.CRITICAL)
sys.path.insert(0, r${JSON.stringify(apiRoot)})
from app.main import app
open(r${JSON.stringify(tmpOut)}, "w", encoding="utf-8").write(json.dumps(app.openapi()))
`;
  const r = spawnSync(py, ['-c', code], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    cwd: apiRoot,
  });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || 'python openapi export failed');
  }
  return JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
}

async function main() {
  let spec;
  try {
    spec = await fetchSpec();
    console.log(`[contracts] fetched ${openapiUrl}`);
  } catch (err) {
    console.warn(`[contracts] fetch failed (${err instanceof Error ? err.message : err}); trying python…`);
    spec = exportViaPython();
    console.log('[contracts] exported via app.main:app');
  }

  fs.mkdirSync(outDir, { recursive: true });
  const normalized = stripApiPrefix(spec);
  fs.writeFileSync(outFile, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  console.log(`[contracts] wrote ${path.relative(root, outFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
