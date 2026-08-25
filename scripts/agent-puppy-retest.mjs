/**
 * Live retest: 「生成一只小狗」 after Alembic 0019 restore.
 * Usage: node scripts/agent-puppy-retest.mjs
 * Env: EVAL_API (default http://127.0.0.1:8000), EVAL_TOKEN / .tmp-token.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API = (process.env.EVAL_API || 'http://127.0.0.1:8000').replace(/\/$/, '');
const outDir = path.join(root, '.tmp-agent-export');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function readToken() {
  const env = (process.env.EVAL_TOKEN || '').trim();
  if (env) return env;
  return fs.readFileSync(path.join(root, '.tmp-token.txt'), 'utf8').trim();
}

const token = readToken();
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function api(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: auth,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathname} ${res.status}: ${text.slice(0, 500)}`);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

const prompt =
  process.env.PUPPY_PROMPT ||
  '生成一只小狗，用 create_image（genPrompt）或 create_shape+create_text 放在画布上。画布约 800x800。';

console.log(`API=${API}`);
console.log(`prompt=${prompt}`);

const body = {
  run_mode: 'agent',
  interaction_mode: 'agent',
  prompt,
  user_selected_model: 'auto',
  project_id: `puppy-retest-${Date.now()}`,
  session_id: `puppy-retest-${Date.now()}`,
  canvas_size: '800x800',
  locale: 'zh-CN',
  design_intensity: 'light',
};

const t0 = Date.now();
const res = await fetch(`${API}/api/v1/design/run`, {
  method: 'POST',
  headers: { ...auth, Accept: 'text/event-stream' },
  body: JSON.stringify(body),
});
if (!res.ok || !res.body) {
  console.error(`run failed ${res.status}: ${(await res.text()).slice(0, 600)}`);
  process.exit(1);
}

let taskId = null;
let lastError = null;
let finished = false;
let opsAll = [];
let lastTxId = '';
let lastPaintBatch = [];
const events = [];
const rawEvents = [];
let buf = '';
const reader = res.body.getReader();
const dec = new TextDecoder();
const deadline = Date.now() + Number(process.env.EVAL_CASE_MS || 600_000);

async function onEvent(ev) {
  if (!ev?.type) return;
  if (ev.task_id) taskId = ev.task_id;
  events.push({ type: ev.type, t: Date.now() - t0 });
  rawEvents.push(ev);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const interesting = [
    'error',
    'result',
    'paused',
    'token',
    'transaction.chunk',
    'tool_ops',
    'scene_feedback_request',
    'ux_tip',
    'decision',
  ];
  if (interesting.includes(ev.type) || (ev.type === 'activity' && !ev.heartbeat)) {
    const extra =
      ev.code ||
      ev.message ||
      ev.summary ||
      ev.detail ||
      (ev.type === 'transaction.chunk' ? `ops=${(ev.ops || []).length}` : '') ||
      '';
    console.log(`  [${dt}s] ${ev.type} ${String(extra).slice(0, 160)}`);
  }

  if (ev.type === 'tool_ops' || ev.type === 'transaction.chunk') {
    const ops = Array.isArray(ev.ops) ? ev.ops : [];
    if (ops.length) {
      opsAll = opsAll.concat(ops);
      lastPaintBatch = ops;
    }
    if (ev.transaction_id) lastTxId = String(ev.transaction_id);
  }
  if (ev.type === 'transaction.begin' || ev.type === 'transaction.commit') {
    if (ev.transaction_id) lastTxId = String(ev.transaction_id);
  }
  if (ev.type === 'scene_feedback_request') {
    const tid = ev.task_id || taskId;
    const round = Number(ev.round || 0);
    const ackOps = lastPaintBatch.length ? lastPaintBatch : opsAll;
    const payload = {
      round,
      scene_nodes: [
        {
          id: `puppy-n-${round}`,
          key: 'rect',
          frame_id: `puppy-f-${round}`,
          x: 0,
          y: 0,
          width: 800,
          height: 800,
          attrs: { fill: '#f8fafc' },
        },
      ],
      scene_frames: [{ id: `puppy-f-${round}`, name: 'Puppy', width: 800, height: 800 }],
      op_results: (ackOps.length ? ackOps : [{}]).map((op, idx) => ({
        op_id: String(op.op_id || `op-${idx}`),
        name: String(op.name || 'noop'),
        ok: true,
      })),
    };
    const tx = String(ev.transaction_id || lastTxId || '').trim();
    if (tx) {
      payload.transaction_id = tx;
      payload.transaction_status = 'ack';
    }
    await api(`/api/v1/design/run/${encodeURIComponent(tid)}/scene`, {
      method: 'POST',
      body: payload,
    });
    console.log(`  [${dt}s] scene ack ops=${ackOps.length} tx=${tx || '-'}`);
  }
  if (ev.type === 'error') lastError = String(ev.message || ev.detail || 'error').slice(0, 400);
  if (ev.type === 'paused') lastError = String(ev.message || ev.reason || 'paused').slice(0, 400);
  if (ev.type === 'result' || ev.type === 'done' || ev.type === 'finish') finished = true;
}

while (Date.now() < deadline) {
  const raced = await Promise.race([
    reader.read().then((r) => ({ kind: 'chunk', r })),
    sleep(15_000).then(() => ({ kind: 'tick' })),
  ]);
  if (raced.kind === 'tick') {
    console.log(
      `  … waiting ${((Date.now() - t0) / 1000).toFixed(0)}s events=${events.length} ops=${opsAll.length}`
    );
    continue;
  }
  const { done, value } = raced.r;
  if (done) break;
  buf += dec.decode(value, { stream: true });
  const chunks = buf.split('\n\n');
  buf = chunks.pop() || '';
  for (const chunk of chunks) {
    const line = chunk
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('');
    if (!line || line === '[DONE]') continue;
    try {
      await onEvent(JSON.parse(line));
    } catch {
      /* ignore */
    }
  }
  if (finished || lastError) break;
}
try {
  reader.cancel();
} catch {
  /* ignore */
}

fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${stamp}_puppy_retest.json`);
const alembicHit = rawEvents.some(
  (e) =>
    String(e.message || e.summary || e.detail || e.text || '')
      .toLowerCase()
      .includes('0019_project_versions') ||
    String(e.message || e.summary || e.detail || e.text || '')
      .toLowerCase()
      .includes('locate revision')
);
const summary = {
  ok: !lastError && !alembicHit && (opsAll.length > 0 || finished),
  ms: Date.now() - t0,
  taskId,
  opsCount: opsAll.length,
  opNames: opsAll.map((o) => o.name),
  alembicHit,
  error: lastError,
  eventTypes: [...new Set(events.map((e) => e.type))],
};
fs.writeFileSync(
  outPath,
  JSON.stringify({ summary, ops: opsAll, events: rawEvents }, null, 2),
  'utf8'
);
console.log('\n', JSON.stringify(summary, null, 2));
console.log('wrote', outPath);
process.exit(summary.ok && !alembicHit ? 0 : 1);
