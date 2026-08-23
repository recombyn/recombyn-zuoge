/**
 * One-shot E2E capture: skills, tool_ops (incl. genPrompt), activity, reply.
 * Usage: node eval/design-agent/e2e-capture.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(path.dirname(here));
const API = (process.env.EVAL_API || process.env.E2E_API || 'http://127.0.0.1:8000').replace(/\/$/, '');

function readToken() {
  const env = (process.env.EVAL_TOKEN || process.env.E2E_TOKEN || '').trim();
  if (env) return env;
  return fs.readFileSync(path.join(root, '.tmp-token.txt'), 'utf8').trim();
}

const token = readToken();
const prompt =
  process.env.E2E_PROMPT ||
  '做一张 1080x1920 夏日音乐节海报。标题 Summer Beat，副标题 July 18 · Riverside Park，主视觉要有舞台与人群氛围，色彩热烈，信息区干净可读。';
const outPath = path.join(root, '.tmp-e2e-poster-capture.json');

function synthSceneFromOps(ops, round) {
  const frames = [];
  const nodes = [];
  let fid = `e2e-frame-${round}`;
  let w = 1080;
  let h = 1920;
  for (const op of ops) {
    const args = op.args || {};
    if (op.name === 'create_frame' || op.name === 'ensure_frame') {
      fid = String(args.id || args.frame_id || fid);
      w = Number(args.width || w) || w;
      h = Number(args.height || h) || h;
    }
  }
  frames.push({ id: fid, name: 'E2E', width: w, height: h });
  let i = 0;
  for (const op of ops) {
    const name = String(op.name || '');
    const args = op.args || {};
    if (!name.includes('create') && name !== 'update_node') continue;
    i += 1;
    const id = String(args.id || `n${round}_${i}`);
    nodes.push({
      id,
      key: String(args.key || args.type || (name.includes('text') ? 'text' : 'rect')),
      frame_id: fid,
      x: Number(args.x ?? 40),
      y: Number(args.y ?? 40 + i * 24),
      width: Number(args.width ?? 200),
      height: Number(args.height ?? 40),
      attrs: {
        ...(args.fill ? { fill: args.fill } : { fill: '#334155' }),
        ...(args.text ? { text: String(args.text) } : {}),
        ...(args.src ? { src: String(args.src) } : {}),
        ...(args.genPrompt || args.prompt
          ? { genPrompt: String(args.genPrompt || args.prompt).slice(0, 500) }
          : {}),
      },
    });
  }
  if (!nodes.length) {
    nodes.push({
      id: `ph-${round}`,
      key: 'rect',
      frame_id: fid,
      x: 0,
      y: 0,
      width: w,
      height: h,
      attrs: { fill: '#0f172a' },
    });
  }
  return { scene_nodes: nodes, scene_frames: frames };
}

function slimOp(op) {
  const a = op.args || {};
  const out = { name: op.name };
  const keep = [
    'id',
    'frameId',
    'frame_id',
    'x',
    'y',
    'width',
    'height',
    'w',
    'h',
    'shapeType',
    'fill',
    'text',
    'fontFamily',
    'fontSize',
    'src',
    'genPrompt',
    'prompt',
    'cutout',
    'role',
  ];
  out.args = {};
  for (const k of keep) {
    if (a[k] !== undefined && a[k] !== null && a[k] !== '') out.args[k] = a[k];
  }
  if (out.args.genPrompt && String(out.args.genPrompt).length > 800) {
    out.args.genPrompt = String(out.args.genPrompt).slice(0, 800) + '…';
  }
  if (out.args.prompt && String(out.args.prompt).length > 800) {
    out.args.prompt = String(out.args.prompt).slice(0, 800) + '…';
  }
  if (out.args.src && String(out.args.src).startsWith('data:')) {
    out.args.src = `data:…(${String(a.src).length} chars)`;
  }
  return out;
}

const t0 = Date.now();
const events = [];
const skills = new Set();
const activity = [];
let opsAll = [];
let taskId = null;
let lastError = null;
let finished = null;
let tokens = '';
let review = null;

const body = {
  run_mode: 'agent',
  interaction_mode: 'agent',
  paint_mode: 'ops',
  prompt,
  user_selected_model: 'auto',
  project_id: `e2e-poster-${Date.now()}`,
  session_id: `e2e-sess-poster-${Date.now()}`,
  canvas_size: '1080x1920',
};

console.log(`API=${API}`);
console.log(`PROMPT=${prompt}`);

const res = await fetch(`${API}/api/v1/design/run`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  },
  body: JSON.stringify(body),
});
if (!res.ok || !res.body) {
  console.error(await res.text());
  process.exit(1);
}

const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '';
const deadline = Date.now() + Number(process.env.EVAL_CASE_MS || 420_000);

while (Date.now() < deadline) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  const chunks = buf.split('\n\n');
  buf = chunks.pop() || '';
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    let data = '';
    for (const line of lines) {
      if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data || data === '[DONE]') continue;
    let ev;
    try {
      ev = JSON.parse(data);
    } catch {
      continue;
    }
    const type = ev?.type;
    if (!type) continue;
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const extra =
      ev.skill_key || ev.key || (type === 'activity' ? ev.detail : '') || ev.message || '';
    console.log(`  [${dt}s] ${type}${extra ? ` ${String(extra).slice(0, 100)}` : ''}`);
    events.push({
      type,
      t: Date.now() - t0,
      skill_key: ev.skill_key || undefined,
      detail: type === 'activity' ? String(ev.detail || '').slice(0, 200) : undefined,
      message: type === 'error' ? ev.message : undefined,
    });
    if (ev.task_id) taskId = ev.task_id;
    if (type === 'skill_start' || type === 'skill_done') {
      const k = ev.skill_key || ev.key || ev.name;
      if (k) skills.add(String(k));
    }
    if (type === 'activity') {
      const detail = String(ev.detail || ev.summary || '');
      activity.push({ kind: ev.kind, status: ev.status, detail: detail.slice(0, 240) });
      for (const k of ['poster_craft', 'image_gen', 'garden_style', 'banner_ad']) {
        if (detail.includes(k)) skills.add(k);
      }
    }
    if (type === 'tool_ops') {
      const ops = Array.isArray(ev.ops) ? ev.ops : [];
      opsAll = opsAll.concat(ops);
    }
    if (type === 'token' || type === 'reply_token') {
      tokens += String(ev.text || ev.token || '');
    }
    if (type === 'review') review = ev;
    if (type === 'error') lastError = ev.message || ev.code || 'error';
    if (type === 'done' || type === 'finished') finished = ev;
    if (type === 'scene_feedback_request') {
      const tid = ev.task_id || taskId;
      const round = Number(ev.round || 0);
      const synth = synthSceneFromOps(opsAll, round);
      await fetch(`${API}/api/v1/design/run/${encodeURIComponent(tid)}/scene`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          round,
          ...synth,
          op_results: (opsAll.length ? opsAll : [{}]).map((op, idx) => ({
            op_id: String(op.op_id || `op-${idx}`),
            name: String(op.name || 'noop'),
            ok: true,
          })),
        }),
      });
    }
  }
  if (finished || lastError) break;
}

try {
  reader.cancel();
} catch {
  /* ignore */
}

const opNames = {};
for (const op of opsAll) {
  const n = String(op.name || '?');
  opNames[n] = (opNames[n] || 0) + 1;
}
const imagePrompts = opsAll
  .filter((o) => o.name === 'create_image')
  .map((o) => ({
    genPrompt: o.args?.genPrompt || o.args?.prompt || null,
    width: o.args?.width || o.args?.w,
    height: o.args?.height || o.args?.h,
    cutout: o.args?.cutout,
    role: o.args?.role,
    hasSrc: Boolean(o.args?.src),
  }));

const report = {
  startedAt: new Date().toISOString(),
  ms: Date.now() - t0,
  api: API,
  prompt,
  taskId,
  ok: Boolean(finished && !lastError && opsAll.length),
  error: lastError,
  skills: [...skills],
  opNames,
  opsCount: opsAll.length,
  imagePrompts,
  ops: opsAll.map(slimOp),
  activity,
  replyPreview: tokens.slice(0, 500),
  review,
  eventTypes: events.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + 1;
    return acc;
  }, {}),
  timeline: events,
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nWrote ${outPath}`);
console.log(
  JSON.stringify(
    {
      ok: report.ok,
      ms: report.ms,
      skills: report.skills,
      opNames: report.opNames,
      imagePrompts: report.imagePrompts,
      error: report.error,
    },
    null,
    2
  )
);
process.exit(report.ok ? 0 : 1);
