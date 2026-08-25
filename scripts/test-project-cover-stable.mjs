/**
 * Live test: cover URL must stay stable when document unchanged.
 *   node scripts/test-project-cover-stable.mjs
 *
 * Fails if server mints new thumb-* URLs on no-op PATCH / extract.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V1 = `${(process.env.FUNC_API || 'http://127.0.0.1:8000').replace(/\/$/, '')}/api/v1`;
const token = (process.env.FUNC_TOKEN || fs.readFileSync(path.join(root, '.tmp-token.txt'), 'utf8')).trim();

async function api(method, urlPath, body, headers = {}) {
  const res = await fetch(`${V1}${urlPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const doc = {
  width: 1080,
  height: 1920,
  deltaSetLike: {
    ROOT: { id: 'ROOT', key: 'entry', children: ['frame1'] },
    frame1: {
      id: 'frame1',
      key: 'frame',
      width: 1080,
      height: 1920,
      children: ['rect1'],
    },
    rect1: {
      id: 'rect1',
      key: 'shape',
      width: 400,
      height: 300,
      fill: '#e11d48',
    },
  },
  pageChildren: ['frame1'],
};

function sig(url) {
  if (!url) return '';
  const list = Array.isArray(url) ? url : [url];
  return list.map((u) => String(u).split('/').pop()?.replace(/\?.*$/, '') || '').join('|');
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

const created = await api('PUT', '/projects', { name: 'cover-stable-test', document: doc });
if (created.status !== 200) fail(`PUT create ${created.status} ${JSON.stringify(created.json)}`);

const { id, revision } = created.json.project;
const thumb0 = sig(created.json.project.thumbnailUrl);
console.log('PUT create thumb:', thumb0 || '(empty)');
if (!thumb0) fail('PUT create returned empty thumbnailUrl');

const patchSame = await api(
  'PATCH',
  `/projects/${id}`,
  { name: 'cover-stable-test', baseRevision: revision },
  { 'If-Match': `"${revision}"` }
);
if (patchSame.status !== 200) fail(`PATCH name-only ${patchSame.status} ${JSON.stringify(patchSame.json)}`);

const thumb1 = sig(patchSame.json.project.thumbnailUrl);
const rev1 = patchSame.json.project.revision;
console.log('PATCH name-only thumb:', thumb1);
if (thumb1 !== thumb0) fail(`thumb changed on name-only PATCH: ${thumb0} -> ${thumb1}`);

const putSame = await api(
  'PUT',
  '/projects',
  { id, name: 'cover-stable-test', document: doc, baseRevision: rev1 },
  { 'If-Match': `"${rev1}"` }
);
if (putSame.status !== 200) fail(`PUT same doc ${putSame.status} ${JSON.stringify(putSame.json)}`);

const thumb2 = sig(putSame.json.project.thumbnailUrl);
const rev2 = putSame.json.project.revision;
console.log('PUT same doc thumb:', thumb2);
if (thumb2 !== thumb0) fail(`thumb changed on same-document PUT: ${thumb0} -> ${thumb2}`);

const extract = await api('POST', `/projects/${id}/covers`, { document: doc });
if (extract.status !== 200) fail(`extract ${extract.status} ${JSON.stringify(extract.json)}`);

const thumb3 = sig(extract.json.project.thumbnailUrl);
console.log('POST extract thumb:', thumb3);
if (thumb3 !== thumb0) fail(`thumb changed on extract same doc: ${thumb0} -> ${thumb3}`);

const list = await api('GET', '/projects?page=1&pageSize=50');
const row = list.json.projects?.find((p) => p.id === id);
const thumb4 = sig(row?.thumbnailUrl);
console.log('LIST thumb:', thumb4);
if (thumb4 !== thumb0) fail(`list thumb mismatch: ${thumb0} -> ${thumb4}`);

await api('DELETE', `/projects/${id}`);
console.log('PASS: cover URL stable across name PATCH, same PUT, extract, and list');
process.exit(0);
