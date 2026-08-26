#!/usr/bin/env node
/** MCP poster smoke — simulates Cursor designing a simple poster via apply_tool_ops */
const API = (process.env.RECOMBYN_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const TOKEN = (process.env.RECOMBYN_TOKEN || '').trim();
const PROJECT = (process.env.RECOMBYN_PROJECT_ID || '1ZxsPIn8CTYZ_myWYO6Yl').trim();
const CODE = (process.env.SUPER_ADMIN_TEST_CODE || '888888').trim();

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function call(tool, args) {
  const data = await api('/api/v1/mcp/canvas/call', {
    method: 'POST',
    body: { tool, arguments: { project_id: PROJECT, ...args } },
  });
  return data.result ?? data;
}

async function mint() {
  const data = await api('/api/v1/auth/email/verify-code', {
    method: 'POST',
    body: { email: 'admin@recombyn.com', code: CODE },
  });
  return String(data.token);
}

async function main() {
  if (!TOKEN) process.env.RECOMBYN_TOKEN = await mint();
  const token = process.env.RECOMBYN_TOKEN || TOKEN;

  console.log('1) get_scene_summary…');
  const before = await call('get_scene_summary', {});
  console.log(`   nodes=${before.nodeCount} frames=${before.frameCount} live=${before.liveSession}`);

  console.log('2) create_frame (poster artboard 540×960)…');
  const frameRes = await call('create_frame', {
    name: 'MCP Poster Test',
    x: 120,
    y: 80,
    width: 540,
    height: 960,
    backgroundColor: '#0f172a',
  });
  console.log(`   status=${frameRes.status} revision=${frameRes.revision}`);

  const frames = await call('list_frames', {});
  const posterFrame =
    (frames.frames || []).find((f) => f.name === 'MCP Poster Test') ||
    (frames.frames || []).slice(-1)[0];
  const frameId = posterFrame?.id;
  if (!frameId) throw new Error('no frame id after create_frame');
  console.log(`   frameId=${frameId}`);

  console.log('3) apply_tool_ops (bg + title + accent shapes)…');
  const paint = await call('apply_tool_ops', {
    ops: [
      {
        name: 'create_shape',
        args: {
          frameId,
          shapeType: 'rect',
          x: 0,
          y: 0,
          width: 540,
          height: 960,
          fill: '#1e3a5f',
        },
      },
      {
        name: 'create_shape',
        args: {
          frameId,
          shapeType: 'ellipse',
          x: 320,
          y: -40,
          width: 280,
          height: 280,
          fill: '#f97316',
        },
      },
      {
        name: 'create_text',
        args: {
          frameId,
          text: 'SUMMER\nFEST',
          x: 48,
          y: 120,
          width: 440,
          fontSize: 72,
          fontWeight: '700',
          fill: '#ffffff',
        },
      },
      {
        name: 'create_text',
        args: {
          frameId,
          text: 'Live Music · Aug 26 · City Plaza',
          x: 48,
          y: 520,
          width: 440,
          fontSize: 22,
          fill: '#cbd5e1',
        },
      },
      {
        name: 'create_shape',
        args: {
          frameId,
          shapeType: 'rect',
          x: 48,
          y: 820,
          width: 200,
          height: 56,
          fill: '#f97316',
          cornerRadius: 28,
        },
      },
      {
        name: 'create_text',
        args: {
          frameId,
          text: 'Get Tickets',
          x: 68,
          y: 834,
          width: 160,
          fontSize: 18,
          fontWeight: '600',
          fill: '#ffffff',
        },
      },
    ],
  });
  console.log(`   status=${paint.status} applied=${paint.applied} revision=${paint.revision}`);

  const after = await call('get_scene_summary', {});
  console.log('4) done —', {
    nodeCount: after.nodeCount,
    frameCount: after.frameCount,
    revision: after.revision,
    posterFrame: frameId,
  });
  console.log('\nOpen editor project', PROJECT, 'to view the poster artboard.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
