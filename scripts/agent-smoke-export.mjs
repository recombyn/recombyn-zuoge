/**
 * Live Design Agent smoke: with/without reference images.
 * Saves importable SceneDocument JSON + raw ops for manual Import JSON.
 *
 * Usage (API up, .tmp-token.txt):
 *   node scripts/agent-smoke-export.mjs
 *   node scripts/agent-smoke-export.mjs no_ref
 *   node scripts/agent-smoke-export.mjs with_ref
 *
 * Env: EVAL_API / STRESS_API, EVAL_TOKEN / STRESS_TOKEN, EVAL_CASE_MS (default 480000)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API = (process.env.EVAL_API || process.env.STRESS_API || 'http://127.0.0.1:8000').replace(
  /\/$/,
  ''
);
const outDir = path.join(root, '.tmp-agent-export');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function readToken() {
  const env = (process.env.EVAL_TOKEN || process.env.STRESS_TOKEN || '').trim();
  if (env) return env;
  const p = path.join(root, '.tmp-token.txt');
  if (!fs.existsSync(p)) {
    console.error('Missing token: set EVAL_TOKEN or run npm run ci:mint-token');
    process.exit(1);
  }
  return fs.readFileSync(p, 'utf8').trim();
}

const token = readToken();
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseSize(raw) {
  const m = String(raw || '').match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (!m) return { w: 1080, h: 1920 };
  return { w: Number(m[1]) || 1080, h: Number(m[2]) || 1920 };
}

function toDataUrl(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function pickRefImage() {
  // Prefer tiny-but-valid fixture for live smoke (Doubao rejects <14px).
  if (String(process.env.SMOKE_REF_TINY || '').trim() === '1') {
    const tiny = path.join(outDir, 'ref-64.png');
    if (fs.existsSync(tiny) && fs.statSync(tiny).size > 100) return tiny;
  }
  const preferred = [
    path.join(outDir, 'ref-64.png'),
    path.join(outDir, 'ref-small.jpg'),
    path.join(root, 'e2e/fixtures/refs/zhuanzhuan-home.png'),
    path.join(root, 'apps/api/storage/results/_sync/pages/0001.png'),
  ];
  for (const p of preferred) {
    if (fs.existsSync(p) && fs.statSync(p).size > 1000) return p;
  }
  // Last resort: 64×64 coral wireframe PNG (meets vision min dimension).
  const fallback = path.join(outDir, 'ref-64.png');
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(fallback)) {
    // 64x64 solid #ff6b35 PNG (precomputed).
    fs.writeFileSync(
      fallback,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAUElEQVR4nO3BMQEAAADCoPVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIC3AAGQAAGQeH+8AAAAAElFTkSuQmCC',
        'base64'
      )
    );
  }
  return fallback;
}

function nodeFromOp(op, i, frameId) {
  const name = String(op.name || op.op_key || '');
  const a = op.args || {};
  const id = String(a.id || a.node_id || `n_${i}`);
  const x = Number(a.x ?? 0);
  const y = Number(a.y ?? 0);
  const w = Number(a.width ?? a.w ?? 200);
  const h = Number(a.height ?? a.h ?? 40);
  const base = { id, x, y, width: w, height: h, frameId };

  if (name === 'create_text') {
    return {
      ...base,
      key: 'text',
      attrs: {
        text: String(a.text || ''),
        fill: String(a.fill || '#111827'),
        fontSize: Number(a.fontSize || a.font_size || 16),
        fontWeight: Number(a.fontWeight || a.font_weight || 400),
        fontFamily: a.fontFamily || a.font_family || undefined,
      },
    };
  }
  if (name === 'create_image') {
    return {
      ...base,
      key: 'image',
      attrs: {
        src: String(a.src || a.url || '').trim(),
        genPrompt: a.genPrompt || a.prompt || undefined,
        name: a.name || 'Image',
        mode: a.mode || 'FILL',
      },
    };
  }
  if (name === 'create_icon' || name === 'create_svg') {
    return {
      ...base,
      key: name === 'create_icon' ? 'icon' : 'svg',
      attrs: {
        svg: a.svg || a.path || '',
        fill: a.fill || '#111827',
        name: a.name || 'Icon',
      },
    };
  }
  if (name === 'create_shape' || name === 'create_rect') {
    return {
      ...base,
      // Editor scene nodes use key "shape" (shapeType in attrs).
      key: 'shape',
      attrs: {
        fill: String(a.fill || '#e2e8f0'),
        cornerRadius: a.cornerRadius ?? a.radius ?? 0,
        opacity: a.opacity,
        shapeType: a.shapeType || a.shape_type || 'rect',
      },
    };
  }
  return null;
}

function documentFromOps(ops, canvasSize, title) {
  const { w, h } = parseSize(canvasSize);
  let fw = w;
  let fh = h;
  let fid = 'frame_main';
  const nodes = [];
  for (let i = 0; i < (ops || []).length; i++) {
    const op = ops[i];
    const name = String(op.name || op.op_key || '');
    const a = op.args || {};
    if (name === 'create_frame' || name === 'ensure_frame') {
      fid = String(a.id || a.frame_id || fid);
      fw = Number(a.width || a.w || fw) || fw;
      fh = Number(a.height || a.h || fh) || fh;
      continue;
    }
    const n = nodeFromOp(op, i, fid);
    if (n) nodes.push(n);
  }
  if (!nodes.length) {
    throw new Error('no drawable ops to build document');
  }
  const delta = { ROOT: { id: 'ROOT', key: 'entry', children: nodes.map((n) => n.id) } };
  for (const n of nodes) {
    const { frameId: _f, ...rest } = n;
    delta[n.id] = rest;
  }
  return {
    width: fw,
    height: fh,
    backgroundColor: '#ffffff',
    frames: [{ id: fid, name: title || 'Board', x: 0, y: 0, width: fw, height: fh, backgroundColor: '#ffffff' }],
    activeFrameId: fid,
    deltaSetLike: delta,
    _meta: {
      nodeCount: nodes.length,
      imageCount: nodes.filter((n) => n.key === 'image').length,
      textCount: nodes.filter((n) => n.key === 'text').length,
      shapeCount: nodes.filter((n) => n.key === 'rect').length,
    },
  };
}

function sceneFromOps(ops, round, canvasSize) {
  const { w, h } = parseSize(canvasSize);
  let fid = `smoke-frame-${round}`;
  let fw = w;
  let fh = h;
  const nodes = [];
  for (let i = 0; i < (ops || []).length; i++) {
    const op = ops[i];
    const name = String(op.name || '');
    const a = op.args || {};
    if (name === 'create_frame' || name === 'ensure_frame') {
      fid = String(a.id || a.frame_id || fid);
      fw = Number(a.width || a.w || fw) || fw;
      fh = Number(a.height || a.h || fh) || fh;
      continue;
    }
    const n = nodeFromOp(op, i, fid);
    if (!n) continue;
    nodes.push({
      id: n.id,
      key: n.key,
      frame_id: fid,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      attrs: n.attrs || {},
    });
  }
  if (!nodes.length) {
    nodes.push({
      id: `placeholder-${round}`,
      key: 'rect',
      frame_id: fid,
      x: 0,
      y: 0,
      width: fw,
      height: fh,
      attrs: { fill: '#f8fafc' },
    });
  }
  return {
    scene_nodes: nodes,
    scene_frames: [{ id: fid, name: 'Smoke', width: fw, height: fh }],
  };
}

async function api(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: auth,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${pathname} ${res.status}: ${text.slice(0, 400)}`);
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

const CASES = [
  {
    id: 'no_ref',
    title: 'Agent No-Ref Poster',
    canvas_size: '1080x1920',
    design_intensity: 'light',
    prompt:
      '做一张 1080x1920 竖版海报：深色背景、大标题「SUMMER」、副标题「Night Market」、底部日期「Aug 2026」。用 create_frame + create_shape + create_text 即可，不要 create_image，不要 emoji。',
  },
  {
    id: 'with_ref',
    title: 'Agent With-Ref Mobile',
    canvas_size: '390x844',
    design_intensity: 'light',
    useRef: true,
    prompt:
      '看附图风格，用 create_frame + create_shape + create_text 快速做一个极简 390x844 线框：顶栏标题、中间一张卡片、底部三个导航文字。只要 4~8 个节点。禁止 create_image / create_icon / emoji。立刻输出 tool ops。',
  },
];

const only = new Set(process.argv.slice(2).filter((a) => a && !a.startsWith('--')));
const cases = CASES.filter((c) => !only.size || only.has(c.id));

async function runCase(c) {
  console.log(`\n=== ${c.id} ===`);
  const t0 = Date.now();
  let opsAll = [];
  /** Latest paint batch only — scene ACK must match `rt.paint_ops`, not cumulative ops. */
  let lastPaintBatch = [];
  let taskId = null;
  let lastError = null;
  let finished = false;
  let lastTxId = '';
  let validateSummary = null;
  const events = [];
  const uxTips = [];
  const rawEvents = [];

  const body = {
    run_mode: 'agent',
    interaction_mode: 'agent',
    prompt: c.prompt,
    user_selected_model: 'auto',
    project_id: `agent-smoke-${c.id}`,
    session_id: `agent-smoke-${c.id}-${Date.now()}`,
    canvas_size: c.canvas_size,
    locale: 'zh-CN',
    design_intensity: c.design_intensity || 'light',
  };

  if (c.useRef) {
    const refPath = pickRefImage();
    console.log(`  ref: ${refPath} (${(fs.statSync(refPath).size / 1024).toFixed(0)}KB)`);
    body.images = [toDataUrl(refPath)];
    body.ref_image_sizes = [c.canvas_size];
    // Keep a copy of the ref for the user.
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(refPath, path.join(outDir, `${stamp}_${c.id}_ref${path.extname(refPath)}`));
  }

  const res = await fetch(`${API}/api/v1/design/run`, {
    method: 'POST',
    headers: { ...auth, Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`run ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + Number(process.env.EVAL_CASE_MS || process.env.STRESS_CASE_MS || 480_000);

  async function onEvent(ev) {
    const type = ev?.type;
    if (!type) return;
    if (ev.task_id) taskId = ev.task_id;
    events.push({ type, t: Date.now() - t0 });
    rawEvents.push(ev);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    if (type === 'activity' && ev.code === 'ops_validate_failed') {
      validateSummary = String(ev.summary || ev.detail || '').slice(0, 1200);
      console.log(`  [${dt}s] VALIDATE FAIL: ${validateSummary}`);
    }

    if (
      [
        'tool_ops',
        'transaction.begin',
        'transaction.chunk',
        'transaction.commit',
        'activity',
        'skill_start',
        'result',
        'error',
        'paused',
        'ux_tip',
        'scene_feedback_request',
        'decision',
      ].includes(type)
    ) {
      const extra =
        ev.skill_key ||
        ev.code ||
        ev.detail ||
        ev.summary ||
        ev.message ||
        (type === 'transaction.chunk' ? `ops=${(ev.ops || []).length}` : '') ||
        '';
      console.log(`  [${dt}s] ${type} ${String(extra).slice(0, 120)}`);
    }

    if (type === 'ux_tip') {
      uxTips.push({ code: ev.code, params: ev.params });
    }

    // Paint path: V3 uses transaction.chunk; legacy still may emit tool_ops.
    if (type === 'tool_ops' || type === 'transaction.chunk') {
      const ops = Array.isArray(ev.ops) ? ev.ops : [];
      if (ops.length) {
        opsAll = opsAll.concat(ops);
        lastPaintBatch = ops;
      }
      if (ev.transaction_id) lastTxId = String(ev.transaction_id);
    }
    if (type === 'transaction.begin' || type === 'transaction.commit') {
      if (ev.transaction_id) lastTxId = String(ev.transaction_id);
    }

    if (type === 'scene_feedback_request') {
      const tid = ev.task_id || taskId;
      const round = Number(ev.round || 0);
      const synth = sceneFromOps(opsAll, round, c.canvas_size);
      const ackOps = lastPaintBatch.length ? lastPaintBatch : opsAll;
      const payload = {
        round,
        ...synth,
        op_results: (ackOps.length ? ackOps : [{}]).map((op, idx) => ({
          op_id: String(op.op_id || `op-${idx}`),
          name: String(op.name || 'noop'),
          ok: true,
        })),
      };
      const tx =
        String(ev.transaction_id || lastTxId || '').trim() ||
        String(opsAll.find((o) => o.transaction_id)?.transaction_id || '').trim();
      if (tx) {
        payload.transaction_id = tx;
        payload.transaction_status = 'ack';
      }
      await api(`/api/v1/design/run/${encodeURIComponent(tid)}/scene`, {
        method: 'POST',
        body: payload,
      });
      console.log(
        `  [${dt}s] scene ack nodes=${synth.scene_nodes.length} ops=${opsAll.length} tx=${tx || '-'}`
      );
    }

    if (type === 'error') lastError = String(ev.message || ev.detail || 'error').slice(0, 400);
    if (type === 'paused') lastError = String(ev.message || ev.reason || 'paused').slice(0, 400);
    if (type === 'result' || type === 'done' || type === 'finish') finished = true;
  }

  while (Date.now() < deadline) {
    const raced = await Promise.race([
      reader.read().then((r) => ({ kind: 'chunk', r })),
      sleep(10_000).then(() => ({ kind: 'tick' })),
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

  const ms = Date.now() - t0;
  const eventTypes = [...new Set(events.map((e) => e.type))];
  const hasChunk = events.some((e) => e.type === 'transaction.chunk');
  const hasToolOps = events.some((e) => e.type === 'tool_ops');

  fs.mkdirSync(outDir, { recursive: true });
  const eventsPath = path.join(outDir, `${stamp}_${c.id}_events.json`);
  fs.writeFileSync(
    eventsPath,
    JSON.stringify({ taskId, validateSummary, events: rawEvents }, null, 2),
    'utf8'
  );

  if (lastError || !opsAll.length) {
    return {
      id: c.id,
      ok: false,
      ms,
      taskId,
      opsCount: opsAll.length,
      error:
        lastError ||
        validateSummary ||
        'agent finished with 0 paint ops (no transaction.chunk / tool_ops)',
      validateSummary,
      eventTypes,
      hasChunk,
      hasToolOps,
      uxTips,
      eventsPath,
    };
  }

  const doc = documentFromOps(opsAll, c.canvas_size, c.title);
  const meta = doc._meta || {};
  delete doc._meta;

  fs.mkdirSync(outDir, { recursive: true });
  const docPath = path.join(outDir, `${stamp}_${c.id}_scene.json`);
  const opsPath = path.join(outDir, `${stamp}_${c.id}_ops.json`);
  const metaPath = path.join(outDir, `${stamp}_${c.id}_meta.json`);
  fs.writeFileSync(docPath, JSON.stringify(doc, null, 2), 'utf8');
  fs.writeFileSync(opsPath, JSON.stringify({ taskId, ops: opsAll }, null, 2), 'utf8');
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        id: c.id,
        title: c.title,
        canvas_size: c.canvas_size,
        withRef: Boolean(c.useRef),
        prompt: c.prompt,
        taskId,
        ms,
        meta,
        eventTypes,
        hasChunk,
        hasToolOps,
        uxTips,
        importHint: 'Editor → Import JSON → pick *_scene.json',
        paths: { docPath, opsPath },
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(
    `  OK nodes=${meta.nodeCount} shapes=${meta.shapeCount} texts=${meta.textCount} images=${meta.imageCount} ms=${ms}`
  );
  console.log(`  wrote ${docPath}`);

  return {
    id: c.id,
    ok: true,
    ms,
    taskId,
    opsCount: opsAll.length,
    meta,
    eventTypes,
    hasChunk,
    hasToolOps,
    uxTips,
    docPath,
    opsPath,
    metaPath,
  };
}

fs.mkdirSync(outDir, { recursive: true });
const results = [];
for (const c of cases) {
  try {
    results.push(await runCase(c));
  } catch (err) {
    console.error(`  FAIL ${c.id}:`, err.message || err);
    results.push({ id: c.id, ok: false, error: String(err.message || err) });
  }
}

const summaryPath = path.join(outDir, `${stamp}_summary.json`);
fs.writeFileSync(
  summaryPath,
  JSON.stringify(
    {
      startedAt: new Date().toISOString(),
      api: API,
      pass: results.filter((r) => r.ok).length,
      fail: results.filter((r) => !r.ok).length,
      results,
    },
    null,
    2
  ),
  'utf8'
);

console.log(`\nSummary → ${summaryPath}`);
for (const r of results) {
  console.log(
    `  ${r.ok ? 'PASS' : 'FAIL'} ${r.id} ops=${r.opsCount ?? 0} chunk=${r.hasChunk} tool_ops=${r.hasToolOps} ${r.docPath || r.error || ''}`
  );
}
process.exit(results.some((r) => !r.ok) ? 1 : 0);
