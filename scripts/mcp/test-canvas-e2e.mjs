#!/usr/bin/env node
/**
 * End-to-end MCP canvas smoke test (HTTP + stdio bridge).
 *
 *   SUPER_ADMIN_TEST_CODE=888888 node scripts/mcp/test-canvas-e2e.mjs
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API = (process.env.RECOMBYN_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const email = (process.env.SUPER_ADMIN_EMAIL || 'admin@recombyn.com').trim().toLowerCase();
const code = (process.env.SUPER_ADMIN_TEST_CODE || '').trim();

const EMPTY_DOC = {
  pageChildren: [],
  frames: [],
  deltaSetLike: { ROOT: { id: 'ROOT', key: 'entry', children: [] } },
};

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

async function apiFetch(pathname, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { res, data };
}

async function mintToken() {
  if (!code) fail('SUPER_ADMIN_TEST_CODE is required');
  const { res, data } = await apiFetch('/api/v1/auth/email/verify-code', {
    method: 'POST',
    body: { email, code },
  });
  if (!res.ok || !data.token) {
    fail(`mint token ${res.status}: ${JSON.stringify(data)}`);
  }
  return String(data.token).trim();
}

async function ensureProject(token) {
  const list = await apiFetch('/api/v1/projects?page=1&pageSize=5', { token });
  if (!list.res.ok) fail(`list projects ${list.res.status}`);
  const existing = list.data?.projects?.[0];
  if (existing?.id) {
    ok(`reuse project ${existing.id}`);
    return existing.id;
  }
  const projectId = `mcp-test-${Date.now()}`;
  const created = await apiFetch('/api/v1/projects', {
    token,
    method: 'PUT',
    body: { id: projectId, name: 'MCP E2E Test', document: EMPTY_DOC },
  });
  if (!created.res.ok) fail(`create project ${created.res.status}: ${JSON.stringify(created.data)}`);
  ok(`created project ${projectId}`);
  return projectId;
}

async function testHttpMcp(token, projectId) {
  const disabled = await fetch(`${API}/api/v1/mcp/canvas/tools`);
  if (disabled.status !== 401 && disabled.status !== 403) {
    // unauthenticated should not be 200
  }

  const tools = await apiFetch('/api/v1/mcp/canvas/tools', { token });
  if (!tools.res.ok) fail(`/tools ${tools.res.status}: ${JSON.stringify(tools.data)}`);
  const names = (tools.data.tools || []).map((t) => t.function?.name).filter(Boolean);
  if (!names.includes('get_scene_summary')) fail('get_scene_summary missing from tools');
  if (!names.includes('create_shape')) fail('create_shape missing from tools');
  ok(`/tools returned ${names.length} tools`);

  const summary = await apiFetch('/api/v1/mcp/canvas/call', {
    token,
    method: 'POST',
    body: {
      tool: 'get_scene_summary',
      arguments: { project_id: projectId },
    },
  });
  if (!summary.res.ok) fail(`get_scene_summary ${summary.res.status}: ${JSON.stringify(summary.data)}`);
  if (summary.data.result?.projectId !== projectId) fail('get_scene_summary wrong projectId');
  ok(`get_scene_summary nodeCount=${summary.data.result?.nodeCount ?? 0}`);

  const create = await apiFetch('/api/v1/mcp/canvas/call', {
    token,
    method: 'POST',
    body: {
      tool: 'create_shape',
      arguments: {
        project_id: projectId,
        shapeType: 'rect',
        x: 40,
        y: 40,
        width: 180,
        height: 100,
        fill: '#FF5533',
      },
    },
  });
  if (!create.res.ok) fail(`create_shape ${create.res.status}: ${JSON.stringify(create.data)}`);
  const status = create.data.result?.status;
  if (!['applied_headless', 'queued_live', 'queued_offline'].includes(status)) {
    fail(`unexpected create_shape status: ${status}`);
  }
  ok(`create_shape status=${status} revision=${create.data.result?.revision}`);

  const after = await apiFetch(`/api/v1/projects/${projectId}`, { token });
  if (!after.res.ok) fail(`get project ${after.res.status}`);
  const nodes = Object.keys(after.data.project?.document?.deltaSetLike || {}).filter((k) => k !== 'ROOT');
  if (nodes.length < 1) fail('project document has no shape after create_shape');
  ok(`project now has ${nodes.length} node(s)`);

  return { revision: create.data.result?.revision };
}

async function testStdioBridge(token, projectId) {
  const bridge = path.join(root, 'scripts', 'mcp', 'recombyn_canvas_stdio.mjs');
  const child = spawn(process.execPath, [bridge], {
    env: {
      ...process.env,
      RECOMBYN_API_URL: API,
      RECOMBYN_TOKEN: token,
      RECOMBYN_PROJECT_ID: projectId,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const pending = new Map();
  let nextId = 1;
  const rl = createInterface({ input: child.stdout });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

  rl.on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id == null) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  });

  child.stderr.on('data', (buf) => {
    const t = String(buf);
    if (t.includes('RECOMBYN_TOKEN is required')) fail(t.trim());
  });

  await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mcp-e2e', version: '1.0.0' },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const listed = await send('tools/list');
  const toolNames = (listed.tools || []).map((t) => t.name);
  if (!toolNames.includes('apply_tool_ops')) fail('stdio tools/list missing apply_tool_ops');
  ok(`stdio tools/list → ${toolNames.length} tools`);

  const called = await send('tools/call', {
    name: 'apply_tool_ops',
    arguments: {
      ops: [
        {
          name: 'create_text',
          args: {
            x: 60,
            y: 160,
            text: 'MCP E2E',
            fontSize: 24,
            fill: '#111111',
          },
        },
      ],
    },
  });
  const text = called.content?.[0]?.text || '';
  const parsed = JSON.parse(text);
  if (!parsed.status) fail(`stdio apply_tool_ops bad payload: ${text.slice(0, 200)}`);
  ok(`stdio apply_tool_ops status=${parsed.status}`);

  child.stdin.end();
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve(undefined);
    }, 5000);
    child.on('close', () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}

async function main() {
  console.log(`MCP E2E → ${API}`);
  const health = await fetch(`${API}/api/v1/health`).catch(() => null);
  if (!health?.ok) fail(`API not reachable at ${API}`);

  const token = await mintToken();
  ok('mint token');

  const projectId = await ensureProject(token);
  await testHttpMcp(token, projectId);
  await testStdioBridge(token, projectId);

  console.log('\n--- Cursor MCP config ---');
  console.log(JSON.stringify(
    {
      mcpServers: {
        'recombyn-canvas': {
          command: 'node',
          args: [path.join(root, 'scripts', 'mcp', 'recombyn_canvas_stdio.mjs')],
          env: {
            RECOMBYN_API_URL: API,
            RECOMBYN_TOKEN: '<paste-token>',
            RECOMBYN_PROJECT_ID: projectId,
          },
        },
      },
    },
    null,
    2
  ));
  console.log(`\nproject_id=${projectId}`);
  console.log('token written to .tmp-mcp-token.txt (gitignored via .tmp-token pattern)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
