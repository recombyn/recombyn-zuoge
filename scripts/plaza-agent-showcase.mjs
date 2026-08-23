/**
 * Real agent → plaza showcase.
 * Runs design agent (hydrated images / lottie), builds documents, submits + approves.
 * Optional: AI video job → video plate board.
 *
 * Usage (API up, .tmp-token.txt):
 *   node scripts/plaza-agent-showcase.mjs
 *   node scripts/plaza-agent-showcase.mjs poster mobile_ui landing video
 *
 * Env: STRESS_API, STRESS_TOKEN, STRESS_CASE_MS (default 420000)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API = process.env.STRESS_API || 'http://127.0.0.1:8000';
const outDir = path.join(root, 'apps/api/seeds/plaza_agent_docs');
const dumpDir = path.join(root, '.tmp-plaza-agent');

function readToken() {
  const env = (process.env.STRESS_TOKEN || '').trim();
  if (env) return env;
  const p = path.join(root, '.tmp-token.txt');
  if (!fs.existsSync(p)) {
    console.error('Missing STRESS_TOKEN or .tmp-token.txt');
    process.exit(1);
  }
  return fs.readFileSync(p, 'utf8').trim();
}

const token = readToken();
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const CASES = [
    {
    id: 'poster',
    projectId: 'agent_plaza_neon_poster',
    title: 'Summer Beat Festival',
    category: 'poster',
    canvas_size: '1080x1920',
    prompt:
      '做一张 1080x1920 夏日音乐节海报。标题 Summer Beat（大号矢量字，必须可读），副标题 July 18 · Riverside Park。主视觉用 create_image 做舞台氛围底图，标题/副标题/日期用 create_text 叠在图上（不要把字烤进图里，不要用 emoji）。信息区干净。',
  },
  {
    id: 'mobile_ui',
    projectId: 'agent_plaza_pulse_mobile',
    title: 'Pulse Fitness App',
    category: 'mobile',
    canvas_size: '390x844',
    prompt:
      '设计一个 390x844 手机 App 首页 UI（健身打卡）。必须是可编辑的界面结构：状态区问候、今日训练卡片、进度环/进度条、推荐列表、底部 Tab（首页/训练/我的）。全部用 create_shape / create_text / create_icon 矢量完成。禁止 create_image，禁止健身房实拍图/哑铃照片，禁止 emoji 当图标。',
  },
  {
    id: 'landing',
    projectId: 'agent_plaza_northstar_landing',
    title: 'Northstar Landing',
    category: 'website',
    canvas_size: '1440x1400',
    prompt:
      '设计一个 1440×1400 官网落地页：AI 设计工具。Hero 大标题+副文案+CTA（矢量字必须大而清晰），右侧可放一张 create_image 产品氛围图（不要盖住标题）。下方功能三列、评价、底栏 CTA。网页区块结构，不要单张活动宣传画。',
  },
  {
    id: 'video',
    projectId: 'agent_plaza_motion_reel',
    title: 'Brand Motion Reel',
    category: 'website',
    kind: 'video_job',
    canvas_size: '1280x720',
    prompt:
      'Cinematic 5-second brand intro for an AI design tool: dark studio, soft cyan light, floating interface panels, elegant motion, no text overlays, 16:9',
  },
];

const only = new Set(process.argv.slice(2).filter((a) => a && !a.startsWith('--')));
const cases = CASES.filter((c) => !only.size || only.has(c.id));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseSize(raw) {
  const m = String(raw || '').match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (!m) return { w: 1080, h: 1920 };
  return { w: Number(m[1]) || 1080, h: Number(m[2]) || 1920 };
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
    const src = String(a.src || a.url || '').trim();
    return {
      ...base,
      key: 'image',
      attrs: {
        src,
        genPrompt: a.genPrompt || a.prompt || undefined,
        name: a.name || 'Image',
        mode: a.mode || 'FILL',
      },
    };
  }
  if (name === 'create_lottie') {
    return {
      ...base,
      key: 'lottie',
      attrs: {
        animationData: a.animationData || a.animation_data || undefined,
        genPrompt: a.genPrompt || a.prompt || undefined,
        name: a.name || 'Lottie',
        src: a.src || undefined,
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
      key: 'rect',
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
  const images = nodes.filter((n) => n.key === 'image' && String(n.attrs?.src || '').startsWith('http'));
  const videos = nodes.filter((n) => n.key === 'video' && String(n.attrs?.src || '').startsWith('http'));
  const lotties = nodes.filter((n) => n.key === 'lottie' && (n.attrs?.animationData || n.attrs?.src));

  const delta = { ROOT: { id: 'ROOT', key: 'entry', children: nodes.map((n) => n.id) } };
  for (const n of nodes) {
    const { frameId: _f, ...rest } = n;
    delta[n.id] = rest;
  }
  return {
    width: fw,
    height: fh,
    backgroundColor: '#0f172a',
    frames: [{ id: fid, name: title || 'Board', x: 0, y: 0, width: fw, height: fh, backgroundColor: '#0f172a' }],
    activeFrameId: fid,
    deltaSetLike: delta,
    _meta: {
      imageCount: images.length,
      videoCount: videos.length,
      lottieCount: lotties.length,
      nodeCount: nodes.length,
    },
  };
}

function documentFromVideo(url, title, canvasSize) {
  const { w, h } = parseSize(canvasSize);
  const fid = 'frame_video';
  const vid = 'video_main';
  const label = 'title_main';
  return {
    width: w,
    height: h,
    backgroundColor: '#020617',
    frames: [{ id: fid, name: title, x: 0, y: 0, width: w, height: h, backgroundColor: '#020617' }],
    activeFrameId: fid,
    deltaSetLike: {
      ROOT: { id: 'ROOT', key: 'entry', children: [vid, label] },
      [vid]: {
        id: vid,
        key: 'video',
        x: 0,
        y: 0,
        width: w,
        height: h,
        attrs: { src: url, name: title, mode: 'FILL', assetKind: 'video' },
      },
      [label]: {
        id: label,
        key: 'text',
        x: 48,
        y: 48,
        width: 600,
        height: 40,
        attrs: { text: title, fill: '#f8fafc', fontSize: 28, fontWeight: 700 },
      },
    },
    _meta: { imageCount: 0, videoCount: 1, lottieCount: 0, nodeCount: 2 },
  };
}

function sceneFromOps(ops, round) {
  const { w, h } = parseSize('1080x1920');
  let fid = `stress-frame-${round}`;
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
      attrs: { fill: '#0f172a' },
    });
  }
  return {
    scene_nodes: nodes,
    scene_frames: [{ id: fid, name: 'Showcase', width: fw, height: fh }],
  };
}

async function api(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: auth,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${pathname} ${res.status}: ${text.slice(0, 400)}`);
  }
  return json;
}

async function deleteFakeSeeds() {
  const feed = await api('/api/v1/plaza/feed?tab=latest&limit=50');
  const items = feed.items || [];
  for (const it of items) {
    const pid = String(it.projectId || '');
    if (!pid.startsWith('seed_plaza_')) continue;
    try {
      await api(`/api/v1/admin/plaza/${encodeURIComponent(it.id)}`, { method: 'DELETE' });
      console.log(`deleted fake ${pid}`);
    } catch (err) {
      console.warn(`delete failed ${pid}:`, err.message || err);
    }
  }
}

async function runAgentCase(c) {
  console.log(`\n=== agent ${c.id} ===`);
  const t0 = Date.now();
  let opsAll = [];
  let taskId = null;
  let lastError = null;
  let finished = false;

  const res = await fetch(`${API}/api/v1/design/run`, {
    method: 'POST',
    headers: { ...auth, Accept: 'text/event-stream' },
    body: JSON.stringify({
      run_mode: 'agent',
      interaction_mode: 'agent',
      prompt: c.prompt,
      user_selected_model: 'auto',
      project_id: c.projectId,
      session_id: `plaza-agent-${c.id}-${Date.now()}`,
      canvas_size: c.canvas_size,
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`run ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + Number(process.env.STRESS_CASE_MS || 420_000);

  async function onEvent(ev) {
    const type = ev?.type;
    if (!type) return;
    if (ev.task_id) taskId = ev.task_id;
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    if (['tool_ops', 'activity', 'skill_start', 'result', 'error', 'paused'].includes(type)) {
      const extra = ev.skill_key || ev.detail || ev.summary || ev.message || '';
      console.log(`  [${dt}s] ${type} ${String(extra).slice(0, 100)}`);
    }
    if (type === 'tool_ops') {
      const ops = Array.isArray(ev.ops) ? ev.ops : [];
      opsAll = opsAll.concat(ops);
    }
    if (type === 'scene_feedback_request') {
      const tid = ev.task_id || taskId;
      const round = Number(ev.round || 0);
      const synth = sceneFromOps(opsAll, round);
      await api(`/api/v1/design/run/${encodeURIComponent(tid)}/scene`, {
        method: 'POST',
        body: {
          round,
          ...synth,
          op_results: (opsAll.length ? opsAll : [{}]).map((op, idx) => ({
            op_id: String(op.op_id || `op-${idx}`),
            name: String(op.name || 'noop'),
            ok: true,
          })),
        },
      });
    }
    if (type === 'error') lastError = String(ev.message || ev.detail || 'error').slice(0, 400);
    if (type === 'paused') lastError = String(ev.message || ev.reason || 'paused').slice(0, 400);
    if (type === 'result' || type === 'done' || type === 'finish') finished = true;
  }

  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
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
        /* ignore partial */
      }
    }
    if (finished || lastError) break;
  }

  if (lastError) throw new Error(lastError);
  if (!opsAll.length) throw new Error('agent finished with 0 tool_ops');

  const doc = documentFromOps(opsAll, c.canvas_size, c.title);
  const meta = doc._meta || {};
  delete doc._meta;
  if (c.id === 'poster' && meta.imageCount < 1) {
    throw new Error(`poster has no hydrated image (images=${meta.imageCount})`);
  }
  if (c.id === 'mobile_ui' && meta.imageCount > 0) {
    // Keep vector UI only — drop lifestyle photos that steal the plaza cover.
    const opsNoImg = opsAll.filter((op) => String(op.name || '') !== 'create_image');
    const docUi = documentFromOps(opsNoImg, c.canvas_size, c.title);
    const metaUi = docUi._meta || {};
    delete docUi._meta;
    console.log(
      `  stripped ${meta.imageCount} image(s) for mobile UI → nodes=${metaUi.nodeCount}`
    );
    return { document: docUi, meta: metaUi, ops: opsNoImg };
  }
  console.log(
    `  built doc nodes=${meta.nodeCount} images=${meta.imageCount} lottie=${meta.lottieCount} ms=${Date.now() - t0}`
  );
  return { document: doc, meta, ops: opsAll };
}

async function runVideoCase(c) {
  console.log(`\n=== video job ${c.id} ===`);
  const created = await api('/api/v1/chat/video/jobs', {
    method: 'POST',
    body: {
      prompt: c.prompt,
      aspect_ratio: '16:9',
      resolution: '720p',
      duration: 5,
    },
  });
  const jobId = created.job_id || created.jobId;
  if (!jobId) throw new Error(`no job_id: ${JSON.stringify(created).slice(0, 200)}`);
  console.log(`  job ${jobId}`);
  const deadline = Date.now() + Number(process.env.STRESS_CASE_MS || 420_000);
  while (Date.now() < deadline) {
    await sleep(4000);
    const st = await api(`/api/v1/chat/video/jobs/${encodeURIComponent(jobId)}`);
    const status = String(st.status || '');
    console.log(`  status=${status} progress=${st.progress ?? 0}`);
    if (status === 'failed' || status === 'error') {
      throw new Error(st.error || 'video job failed');
    }
    if (status === 'succeeded' || status === 'done' || status === 'completed') {
      const result = st.result || {};
      const assets = result.assets || result.videos || [];
      let url = '';
      if (Array.isArray(assets) && assets.length) {
        const first = assets[0];
        url = typeof first === 'string' ? first : String(first.url || first.src || '');
      }
      if (!url && Array.isArray(result.videos)) url = String(result.videos[0] || '');
      if (!url) throw new Error(`video done but no url: ${JSON.stringify(result).slice(0, 300)}`);
      const doc = documentFromVideo(url, c.title, c.canvas_size);
      const meta = doc._meta;
      delete doc._meta;
      return { document: doc, meta, ops: [] };
    }
  }
  throw new Error('video job timeout');
}

async function publishOfficial(c, document) {
  // Persist dump for seed reload / debugging
  fs.mkdirSync(dumpDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const payload = {
    projectId: c.projectId,
    title: c.title,
    category: c.category,
    authorName: 'Recombyn Official',
    document,
  };
  fs.writeFileSync(path.join(dumpDir, `${c.id}.json`), JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(outDir, `${c.id}.json`), JSON.stringify(payload, null, 2));

  // Hide previous same projectId if any
  try {
    const feed = await api('/api/v1/plaza/feed?tab=latest&limit=50');
    for (const it of feed.items || []) {
      if (String(it.projectId) === c.projectId) {
        await api(`/api/v1/admin/plaza/${encodeURIComponent(it.id)}`, { method: 'DELETE' });
      }
    }
  } catch {
    /* ignore */
  }

  const submitted = await api('/api/v1/plaza/submit', {
    method: 'POST',
    body: {
      projectId: c.projectId,
      title: c.title,
      category: c.category,
      document,
    },
  });
  const sid = submitted.item?.id || submitted.id;
  if (!sid) throw new Error('submit missing id');
  await api(`/api/v1/admin/plaza/${encodeURIComponent(sid)}/approve`, { method: 'POST' });
  // Prefer Official author via title path already; admin can't easily rewrite userId here.
  console.log(`  published+approved ${sid}`);
  return sid;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`plaza agent showcase api=${API} cases=${cases.map((c) => c.id).join(',')}`);
  await deleteFakeSeeds();

  const results = [];
  for (const c of cases) {
    try {
      const out = c.kind === 'video_job' ? await runVideoCase(c) : await runAgentCase(c);
      const sid = await publishOfficial(c, out.document);
      results.push({
        id: c.id,
        ok: true,
        sid,
        images: out.meta?.imageCount ?? 0,
        videos: out.meta?.videoCount ?? 0,
      });
    } catch (err) {
      console.error(`FAIL ${c.id}:`, err.message || err);
      results.push({ id: c.id, ok: false, error: String(err.message || err).slice(0, 300) });
    }
  }

  const summaryPath = path.join(dumpDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));
  console.log('\nSUMMARY', results);
  console.log('wrote', summaryPath);
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
