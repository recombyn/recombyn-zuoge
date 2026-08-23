/**
 * Smoke: plugin install route + chat image/video/audio jobs enqueue.
 * Usage: TOK=$(cat .tmp-token.txt) node scripts/smoke-media-plugin.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = (process.env.E2E_API || process.env.BASE_URL || 'http://127.0.0.1:8000').replace(
  /\/$/,
  ''
);
let tok = (process.env.TOK || process.env.E2E_TOKEN || '').trim();
if (!tok) {
  const p = path.join(root, '.tmp-token.txt');
  if (existsSync(p)) tok = readFileSync(p, 'utf8').trim();
}
if (!tok) {
  console.error('missing TOK / E2E_TOKEN / .tmp-token.txt');
  process.exit(1);
}

const h = { Authorization: `Bearer ${tok}` };

async function j(method, url, body) {
  const r = await fetch(`${api}${url}`, {
    method,
    headers: { ...h, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let d;
  try {
    d = JSON.parse(t);
  } catch {
    d = t;
  }
  return { status: r.status, d };
}

const results = [];
function ok(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

let r = await j('GET', '/api/v1/health');
ok('health', r.status === 200, String(r.status));

r = await j('GET', '/api/v1/design/skills');
ok('design.skills', r.status === 200, `status=${r.status}`);

r = await fetch(`${api}/api/v1/design/plugins/install`, { method: 'POST', headers: h });
ok(
  'plugins.install.route',
  [400, 415, 422].includes(r.status),
  `status=${r.status} (expect missing-file client error)`
);

for (const kind of ['image', 'video', 'audio']) {
  const payload =
    kind === 'audio'
      ? { prompt: 'hello smoke' }
      : { prompt: `smoke ${kind}` };
  r = await j('POST', `/api/v1/chat/${kind}/jobs`, payload);
  const acceptable = [200, 402, 503, 502];
  ok(
    `${kind}.jobs.create`,
    acceptable.includes(r.status),
    `status=${r.status} body=${JSON.stringify(r.d).slice(0, 140)}`
  );
  if (r.status === 200 && r.d?.job_id) {
    const g = await j('GET', `/api/v1/chat/${kind}/jobs/${r.d.job_id}`);
    ok(`${kind}.jobs.get`, g.status === 200, `status=${g.d?.status}`);
  }
}

const failed = results.filter((x) => !x.ok);
console.log(JSON.stringify({ pass: results.length - failed.length, fail: failed.length, failed }, null, 2));
process.exit(failed.length ? 1 : 0);
