/**
 * Live test: cover URLs after PUT/PATCH with a visible red rect.
 *   node scripts/test-project-cover-visible.mjs
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
  return { status: res.status, json: await res.json() };
}

const doc = {
  width: 1080,
  height: 1920,
  deltaSetLike: {
    ROOT: { id: 'ROOT', key: 'entry', children: ['frame1'] },
    frame1: {
      id: 'frame1',
      key: 'frame',
      name: '画板 1',
      width: 1080,
      height: 1920,
      x: 0,
      y: 0,
      backgroundColor: '#333333',
      children: ['rect1'],
    },
    rect1: {
      id: 'rect1',
      key: 'shape',
      type: 'rect',
      x: 100,
      y: 100,
      width: 400,
      height: 300,
      fill: '#e11d48',
      parentId: 'frame1',
    },
  },
  frames: [{ id: 'frame1', name: '画板 1', width: 1080, height: 1920, x: 0, y: 0 }],
  pageChildren: ['frame1'],
  activeFrameId: 'frame1',
};

function sig(url) {
  if (!url) return '(empty)';
  const list = Array.isArray(url) ? url : [url];
  return list.map((u) => String(u).split('/').pop()).join('|');
}

const created = await api('PUT', '/projects', { name: 'cover-visible-test', document: doc });
if (created.status !== 200) {
  console.error('PUT failed', created.status, created.json);
  process.exit(1);
}
const { id, revision } = created.json.project;
console.log('PUT  thumb:', sig(created.json.project.thumbnailUrl), 'rev', revision);

const list1 = await api('GET', '/projects?page=1&pageSize=50');
const row1 = list1.json.projects.find((p) => p.id === id);
console.log('LIST thumb:', sig(row1?.thumbnailUrl));

const list2 = await api('GET', '/projects?page=1&pageSize=50');
const row2 = list2.json.projects.find((p) => p.id === id);
console.log('LIST after save:', sig(row2?.thumbnailUrl));

await api('DELETE', `/projects/${id}`);
const hasCover = Boolean(sig(row2?.thumbnailUrl) && sig(row2?.thumbnailUrl) !== '(empty)');
console.log(hasCover ? 'COVER OK' : 'COVER MISSING — server did not generate thumb for shape rect');
process.exit(hasCover ? 0 : 1);
