/**
 * Live test: project rename + cover appear in GET /projects list.
 *   node scripts/test-project-list-sync.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = (process.env.FUNC_API || 'http://127.0.0.1:8000').replace(/\/$/, '');
const V1 = `${API}/api/v1`;

function readToken() {
  const env = (process.env.FUNC_TOKEN || '').trim();
  if (env) return env;
  const p = path.join(root, '.tmp-token.txt');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : '';
}

const token = readToken();
if (!token) {
  console.error('No token — set FUNC_TOKEN or .tmp-token.txt');
  process.exit(1);
}

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
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

function pickProject(json) {
  return json?.project ?? json;
}

function emptyDoc() {
  return {
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
        backgroundColor: '#ffffff',
        children: [],
      },
    },
    frames: [{ id: 'frame1', name: '画板 1', width: 1080, height: 1920, x: 0, y: 0 }],
    pageChildren: ['frame1'],
    activeFrameId: 'frame1',
  };
}

function docWithRedRect(base) {
  const doc = structuredClone(base);
  doc.deltaSetLike.ROOT.children.push('rect1');
  doc.deltaSetLike.rect1 = {
    id: 'rect1',
    key: 'shape',
    type: 'rect',
    x: 100,
    y: 100,
    width: 400,
    height: 300,
    fill: '#e11d48',
    parentId: 'frame1',
  };
  doc.deltaSetLike.frame1.children = ['rect1'];
  return doc;
}

function listRow(listJson, id) {
  const projects = listJson?.projects ?? [];
  return projects.find((p) => p.id === id) ?? null;
}

function thumbSig(url) {
  if (!url) return '(none)';
  const list = Array.isArray(url) ? url : [url];
  return list.map((u) => String(u).split('/').pop()).join('|');
}

async function main() {
  console.log(`API: ${API}\n`);
  let failed = 0;

  const created = await api('PUT', '/projects', {
    name: 'sync-test-未命名',
    document: emptyDoc(),
  });
  if (created.status !== 200) {
    console.error('CREATE failed', created.status, created.json);
    process.exit(1);
  }
  const project = pickProject(created.json);
  const id = project.id;
  let rev = project.revision;
  console.log(`created id=${id} rev=${rev} thumb=${thumbSig(project.thumbnailUrl)}`);

  const list0 = await api('GET', '/projects?page=1&pageSize=50');
  const row0 = listRow(list0.json, id);
  console.log(`list after create: name=${row0?.name} thumb=${thumbSig(row0?.thumbnailUrl)} updatedAt=${row0?.updatedAt}`);

  const rename = `sync-test-啦啦啦啦-${Date.now()}`;
  const renamed = await api('PATCH', `/projects/${id}`, {
    name: rename,
    baseRevision: rev,
  });
  if (renamed.status !== 200) {
    console.error('RENAME PATCH failed', renamed.status, renamed.json);
    failed++;
  } else {
    const p = pickProject(renamed.json);
    rev = p.revision;
    console.log(`patch rename only: name=${p.name} thumb=${thumbSig(p.thumbnailUrl)} rev=${rev}`);
  }

  const list1 = await api('GET', '/projects?page=1&pageSize=50');
  const row1 = listRow(list1.json, id);
  const nameOk = row1?.name === rename;
  console.log(`list after rename: name=${row1?.name} (${nameOk ? 'OK' : 'FAIL'})`);
  if (!nameOk) failed++;

  const doc2 = docWithRedRect(emptyDoc());
  const patched = await api('PATCH', `/projects/${id}`, {
    name: rename,
    baseRevision: rev,
    upsertNodes: doc2.deltaSetLike,
    pageChildren: doc2.pageChildren,
    frames: doc2.frames,
  });
  if (patched.status !== 200) {
    console.error('DOC PATCH failed', patched.status, patched.json);
    failed++;
  } else {
    const p = pickProject(patched.json);
    rev = p.revision;
    const thumbBefore = thumbSig(row1?.thumbnailUrl);
    const thumbAfter = thumbSig(p.thumbnailUrl);
    const coverOk = thumbAfter !== thumbBefore || thumbAfter !== '(none)';
    console.log(
      `patch doc: thumb ${thumbBefore} -> ${thumbAfter} (${coverOk ? 'CHANGED' : 'UNCHANGED'}) rev=${rev}`
    );
    if (!coverOk) failed++;
  }

  await new Promise((r) => setTimeout(r, 500));
  const list2 = await api('GET', '/projects?page=1&pageSize=50');
  const row2 = listRow(list2.json, id);
  const listThumb = thumbSig(row2?.thumbnailUrl);
  const patchThumb = thumbSig(pickProject(patched.json)?.thumbnailUrl);
  const listCoverOk = listThumb === patchThumb && listThumb !== '(none)';
  console.log(
    `list after doc edit: thumb=${listThumb} matches patch=${patchThumb} (${listCoverOk ? 'OK' : 'FAIL'})`
  );
  if (!listCoverOk) failed++;

  await api('DELETE', `/projects/${id}`);

  console.log(failed ? `\nFAILED (${failed} checks)` : '\nALL PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
