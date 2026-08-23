/**
 * Full-surface HTTP functional suite (Gate A) — one request-level pass over
 * every major product API: health, auth, wallet, me, projects, plaza, design,
 * skills, collab, shares, admin, notices, fonts, assets, chat, image tools,
 * import validation, users directory.
 *
 *   npm run test:functional:api
 *   FUNC_API=http://127.0.0.1:8000 FUNC_TOKEN=… node scripts/functional-api-suite.mjs
 *
 * Requires live API + token (.tmp-token.txt / FUNC_TOKEN / E2E_TOKEN).
 * Destructive cases create then delete their own project/share fixtures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = (process.env.FUNC_API || process.env.BASE_URL || process.env.STRESS_API || 'http://127.0.0.1:8000').replace(
  /\/$/,
  ''
);
const V1 = `${API}/api/v1`;

function readToken() {
  const env = (
    process.env.FUNC_TOKEN ||
    process.env.E2E_TOKEN ||
    process.env.STRESS_TOKEN ||
    process.env.PERF_TOKEN ||
    ''
  ).trim();
  if (env) return env;
  const p = path.join(root, '.tmp-token.txt');
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8').trim();
}

const token = readToken();
if (!token) {
  console.error('Missing FUNC_TOKEN / E2E_TOKEN / .tmp-token.txt');
  process.exit(1);
}

const results = [];
let failed = 0;

function okStatus(status, allowed) {
  return allowed.includes(status);
}

async function req(method, urlPath, { body, auth = true, allowed = [200] } = {}) {
  const headers = { Accept: 'application/json' };
  if (auth) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${urlPath.startsWith('http') ? urlPath : V1 + urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, json, ok: okStatus(res.status, allowed) };
}

async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    results.push({ name, ok: true, ms });
    console.log(`  ✓ ${name} (${ms}ms)`);
  } catch (e) {
    failed += 1;
    const ms = Date.now() - t0;
    const msg = String(e?.message || e).slice(0, 240);
    results.push({ name, ok: false, ms, error: msg });
    console.error(`  ✘ ${name} (${ms}ms): ${msg}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

console.log(`[functional:api] api=${API}`);

await check('health', async () => {
  const r = await req('GET', '/health', { auth: false });
  assert(r.ok, `status=${r.status}`);
  assert(r.json?.checks?.api === true, 'checks.api');
});

await check('metrics', async () => {
  const r = await req('GET', `${API}/metrics`, { auth: false, allowed: [200] });
  assert(r.ok, `status=${r.status}`);
  const body = String(r.json?._raw || JSON.stringify(r.json) || '');
  assert(
    body.includes('# HELP') ||
      body.includes('python_') ||
      body.includes('recombyn_') ||
      body.includes('http_request'),
    'prometheus body'
  );
});

await check('auth.config', async () => {
  const r = await req('GET', '/auth/config', { auth: false });
  assert(r.ok, `status=${r.status}`);
});

await check('auth.me', async () => {
  const r = await req('GET', '/auth/me');
  assert(r.ok, `status=${r.status}`);
  assert(r.json?.user?.id, 'user.id');
});

await check('auth.me.unauthorized', async () => {
  const r = await req('GET', '/auth/me', { auth: false, allowed: [401, 403] });
  assert(r.ok, `status=${r.status}`);
});

await check('wallet.me', async () => {
  const r = await req('GET', '/wallet');
  assert(r.ok, `status=${r.status}`);
});

await check('wallet.ledger', async () => {
  const r = await req('GET', '/wallet/ledger');
  assert(r.ok, `status=${r.status}`);
});

await check('wallet.purchase-info', async () => {
  const r = await req('GET', '/wallet/purchase-info', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('me.liked', async () => {
  const r = await req('GET', '/me/liked', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('me.liked.ids', async () => {
  const r = await req('GET', '/me/liked/ids', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('me.byok.providers', async () => {
  const r = await req('GET', '/me/byok/providers', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

let projectId = '';
await check('projects.crud', async () => {
  const created = await req('PUT', '/projects', {
    body: { name: `func-suite-${Date.now()}`, document: null },
    allowed: [200],
  });
  assert(created.ok, `create status=${created.status} ${JSON.stringify(created.json).slice(0, 160)}`);
  projectId = String(created.json?.project?.id || created.json?.id || '').trim();
  assert(projectId, 'project id');

  const one = await req('GET', `/projects/${projectId}`);
  assert(one.ok, `get status=${one.status}`);
  const baseRevision =
    one.json?.project?.revision ?? one.json?.revision ?? created.json?.project?.revision ?? null;
  assert(baseRevision != null, 'project revision for patch');

  const list = await req('GET', '/projects?page=1&pageSize=20');
  assert(list.ok, `list status=${list.status}`);

  const patched = await req('PATCH', `/projects/${projectId}`, {
    body: {
      name: `func-suite-renamed-${Date.now()}`,
      baseRevision,
    },
    allowed: [200],
  });
  assert(patched.ok, `patch status=${patched.status} ${JSON.stringify(patched.json).slice(0, 160)}`);
});

await check('projects.revision_conflict', async () => {
  assert(projectId, 'need project');
  const one = await req('GET', `/projects/${projectId}`);
  assert(one.ok, `get status=${one.status}`);
  const rev = one.json?.project?.revision ?? one.json?.revision;
  assert(rev != null, 'revision');

  const okPatch = await req('PATCH', `/projects/${projectId}`, {
    body: { name: `func-suite-conflict-ok-${Date.now()}`, baseRevision: rev },
    allowed: [200],
  });
  assert(okPatch.ok, `ok patch status=${okPatch.status}`);

  // Same stale baseRevision after a successful bump → optimistic lock 412.
  const stale = await req('PATCH', `/projects/${projectId}`, {
    body: { name: `func-suite-conflict-stale-${Date.now()}`, baseRevision: rev },
    allowed: [412],
  });
  assert(stale.ok, `stale status=${stale.status} ${JSON.stringify(stale.json).slice(0, 200)}`);
  const code = stale.json?.detail?.code || stale.json?.code;
  assert(code === 'project_revision_conflict', `code=${code}`);
});

await check('collab.room-token', async () => {
  assert(projectId, 'need project');
  const r = await req('POST', '/collab/room-token', {
    body: { projectId },
    allowed: [200],
  });
  assert(r.ok, `status=${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
  assert(r.json?.token || r.json?.roomToken || r.json?.roomId, 'token/room');
});

let shareId = '';
await check('shares.create_get', async () => {
  assert(projectId, 'need project');
  const doc = {
    version: 1,
    nodes: {},
    frames: [],
  };
  const created = await req('PUT', '/shares', {
    body: {
      name: 'func-share',
      permission: 'preview',
      document: doc,
      sourceProjectId: projectId,
      linkPublic: true,
    },
    allowed: [200],
  });
  assert(created.ok, `create status=${created.status} ${JSON.stringify(created.json).slice(0, 200)}`);
  shareId = String(
    created.json?.share?.id || created.json?.id || created.json?.shareId || ''
  ).trim();
  assert(shareId, 'share id');
  const got = await req('GET', `/shares/${shareId}`, { auth: false, allowed: [200] });
  assert(got.ok, `public get status=${got.status}`);
});

await check('plaza.feed', async () => {
  const r = await req('GET', '/plaza/feed?page=1&pageSize=12', { auth: false, allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('plaza.mine', async () => {
  const r = await req('GET', '/plaza/mine', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('plaza.item_optional', async () => {
  const feed = await req('GET', '/plaza/feed?page=1&pageSize=5', { auth: false });
  const items =
    feed.json?.items || feed.json?.list || feed.json?.data || feed.json?.submissions || [];
  if (!Array.isArray(items) || !items.length) {
    console.log('    (skip item — empty feed)');
    return;
  }
  const id = String(items[0].id || items[0].submissionId || '').trim();
  assert(id, 'feed item id');
  const one = await req('GET', `/plaza/items/${id}`, { allowed: [200] });
  assert(one.ok, `item status=${one.status}`);
});

await check('design.catalog', async () => {
  const r = await req('GET', '/design/catalog');
  assert(r.ok, `status=${r.status}`);
});

await check('design.canvas-tools', async () => {
  const r = await req('GET', '/design/canvas-tools');
  assert(r.ok, `status=${r.status}`);
});

await check('design.skills', async () => {
  const r = await req('GET', '/design/skills');
  assert(r.ok, `status=${r.status}`);
});

await check('admin.me', async () => {
  const r = await req('GET', '/admin/me', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('admin.users', async () => {
  const r = await req('GET', '/admin/users?page=1&pageSize=10', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('admin.plaza', async () => {
  const r = await req('GET', '/admin/plaza', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('admin.design.skills', async () => {
  const r = await req('GET', '/admin/design/skills', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('admin.design.runtime-settings', async () => {
  const r = await req('GET', '/admin/design/runtime-settings', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('notices', async () => {
  const r = await req('GET', '/notices', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('fonts', async () => {
  const r = await req('GET', '/fonts', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('assets', async () => {
  const r = await req('GET', '/assets', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('users.search', async () => {
  const r = await req('GET', '/users/search?q=a&limit=5', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('chat.models', async () => {
  const r = await req('GET', '/chat/models', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('chat.agent.tools', async () => {
  const r = await req('GET', '/chat/agent/tools', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('chat.sessions', async () => {
  const r = await req('GET', '/chat-sessions/sessions', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('image.tools', async () => {
  const r = await req('GET', '/image/tools', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('auth.captcha.create', async () => {
  const r = await req('POST', '/auth/captcha/create', { auth: false, allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('admin.fonts', async () => {
  const r = await req('GET', '/admin/fonts', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('admin.projects', async () => {
  const r = await req('GET', '/admin/projects?page=1&pageSize=5', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('admin.likes', async () => {
  const r = await req('GET', '/admin/likes?page=1&pageSize=5', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('admin.plaza.feed', async () => {
  const r = await req('GET', '/admin/plaza/feed?page=1&pageSize=5', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('admin.models.image-limit-presets', async () => {
  const r = await req('GET', '/admin/models/image-limit-presets', { allowed: [200] });
  assert(r.ok, `status=${r.status}`);
});

await check('import.image.validation', async () => {
  const r = await req('POST', '/import/image', { body: {}, allowed: [400, 422] });
  assert(r.ok, `status=${r.status}`);
});

await check('projects.cleanup', async () => {
  if (!projectId) return;
  const r = await req('DELETE', `/projects/${projectId}`, { allowed: [200] });
  assert(r.ok, `delete status=${r.status}`);
});

const pass = results.filter((x) => x.ok).length;
const out = {
  startedAt: new Date().toISOString(),
  api: API,
  pass,
  fail: failed,
  total: results.length,
  results,
};
const outPath = path.join(root, '.tmp-functional-api-result.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(`\nWrote ${outPath} pass=${pass} fail=${failed}`);
process.exit(failed ? 1 : 0);
