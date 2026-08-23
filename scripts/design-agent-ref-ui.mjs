/**
 * SSE design-agent stress with reference images (data URLs).
 * Usage:
 *   node scripts/design-agent-ref-ui.mjs
 *   node scripts/design-agent-ref-ui.mjs home
 *   node scripts/design-agent-ref-ui.mjs detail
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API = process.env.STRESS_API || 'http://127.0.0.1:8000';
const OUT = process.env.STRESS_OUT || path.join(root, '.tmp-agent-ref-ui-sse.json');
const token = (
  process.env.STRESS_TOKEN ||
  fs.readFileSync(path.join(root, '.tmp-token.txt'), 'utf8')
).trim();

const FIX = path.join(root, 'e2e/fixtures/refs');

function toDataUrl(filePath) {
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString('base64');
  return `data:image/png;base64,${b64}`;
}

const CASES = [
  {
    id: 'ref_home',
    skill_expect: ['mobile_app_ui'],
    image: path.join(FIX, 'zhuanzhuan-home.png'),
    canvas_size: '390x844',
    prompt:
      '参考附图，做一张 390x844 手机 App 首页 UI（二手电商风格）。还原：顶栏搜索、分类入口、大促横幅区、双排品类、回收入口、底栏 Tab。可编辑矢量；图标用矢量字形，不要 emoji；不要整屏位图糊弄。',
  },
  {
    id: 'ref_detail_middle',
    skill_expect: ['long_scroll', 'ecommerce_surface'],
    image: path.join(FIX, 'summer-detail-middle.png'),
    canvas_size: '750x1600',
    prompt:
      '参考附图做详情/活动长图的「中间区域」：摊位导览地图板块（打卡必存超全摊位导览 + 等距摊位示意），不是整页复制。约 750 宽；中间导览区完整可读；矢量为主，不要 emoji 当图标。',
  },
];

const only = new Set(process.argv.slice(2).filter((a) => a && !a.startsWith('--')));
const cases = CASES.filter((c) => {
  if (!only.size) return true;
  if (only.has('home') && c.id === 'ref_home') return true;
  if (only.has('detail') && c.id === 'ref_detail_middle') return true;
  return only.has(c.id);
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postScene(taskId, body) {
  await fetch(`${API}/api/v1/design/scene`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ task_id: taskId, ...body }),
  }).catch(() => undefined);
}

function summarizeOps(ops) {
  return ops.slice(0, 40).map((op) => {
    const n = op.name || op.op || '?';
    const a = op.args || {};
    if (n === 'create_text') return `${n} "${String(a.text || '').slice(0, 24)}"`;
    if (n === 'create_icon') return `${n} svg=${a.svg ? 'yes' : 'no'}`;
    if (n === 'create_image') return `${n} ${a.genPrompt ? 'gen' : a.attachmentIndex != null ? 'att' : ''}`;
    return `${n}${a.fill ? ` ${a.fill}` : ''}`;
  });
}

function craftFlags(ops) {
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  let emojiText = 0;
  let iconOps = 0;
  const names = [];
  for (const op of ops) {
    const n = String(op.name || '');
    names.push(n);
    const a = op.args || {};
    if (n === 'create_text' && emojiRe.test(String(a.text || ''))) emojiText += 1;
    if (n === 'create_icon' || n === 'create_svg') iconOps += 1;
    if (n === 'create_shape' && (a.path || a.d || a.svg)) iconOps += 1;
  }
  const flags = [];
  if (emojiText) flags.push(`emoji_text_ops:${emojiText}`);
  if (iconOps < 1) flags.push('no_vector_icon_ops');
  return { flags, iconOps, emojiText, names: [...new Set(names)].slice(0, 24) };
}

async function runCase(c) {
  const t0 = Date.now();
  const images = [toDataUrl(c.image)];
  console.log(`\n=== ${c.id} start (${(images[0].length / 1024).toFixed(0)}KB dataUrl) ===`);
  const skills = new Set();
  const events = [];
  let opsAll = [];
  let lastError = null;
  let finished = null;
  let taskId = null;
  let tokens = '';
  let review = null;

  const res = await fetch(`${API}/api/v1/design/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      run_mode: 'agent',
      interaction_mode: 'agent',
      prompt: c.prompt,
      user_selected_model: 'auto',
      project_id: `stress-ref-${c.id}`,
      session_id: `stress-ref-${c.id}-${Date.now()}`,
      canvas_size: c.canvas_size,
      images,
    }),
  });
  if (!res.ok || !res.body) {
    const t = await res.text();
    throw new Error(`run ${res.status}: ${t.slice(0, 400)}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + Number(process.env.STRESS_CASE_MS || 480_000);

  async function handleEvent(ev) {
    const type = ev?.type;
    if (!type) return;
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const extra = ev.skill_key || ev.detail || ev.summary || ev.message || '';
    console.log(`  [${dt}s] ${type}${extra ? ` ${String(extra).slice(0, 80)}` : ''}`);
    events.push({ type, t: Date.now() - t0, skill_key: ev.skill_key });
    if (ev.task_id) taskId = ev.task_id;
    if (type === 'decision') {
      console.log(
        `  [${dt}s] decision has_ref_images=${ev.has_ref_images} route=${ev.route || ''}`
      );
    }
    if (type === 'skill_start' || type === 'skill_done') {
      const k = ev.skill_key || ev.key;
      if (k) skills.add(String(k));
    }
    if (type === 'activity') {
      const d = String(ev.detail || ev.summary || '');
      for (const expect of c.skill_expect || []) {
        if (d.includes(expect)) skills.add(expect);
      }
    }
    if (type === 'tool_ops') {
      opsAll = opsAll.concat(Array.isArray(ev.ops) ? ev.ops : []);
    }
    if (type === 'scene_feedback_request') {
      await postScene(ev.task_id || taskId, {
        round: Number(ev.round || 0),
        frames: [{ id: 'f1', name: 'Ref', width: 390, height: 844 }],
        nodes: [],
        op_results: (opsAll.length ? opsAll : [{}]).map((op, idx) => ({
          op_id: String(op.op_id || `op-${idx}`),
          name: String(op.name || 'noop'),
          ok: true,
        })),
      });
    }
    if (type === 'token') tokens += String(ev.text || '');
    if (type === 'critique_done') {
      review = { ok: ev.ok, source: ev.source || ev.agent };
    }
    if (type === 'error' || type === 'paused') {
      lastError = String(ev.message || ev.detail || ev.reason || type).slice(0, 400);
    }
    if (type === 'result' || type === 'done' || type === 'finish') finished = ev;
  }

  let pending = reader.read();
  while (Date.now() < deadline) {
    const raced = await Promise.race([
      pending.then((r) => ({ kind: 'chunk', r })),
      sleep(8_000).then(() => ({ kind: 'tick' })),
    ]);
    if (raced.kind === 'tick') {
      console.log(`  … waiting ${((Date.now() - t0) / 1000).toFixed(0)}s events=${events.length} ops=${opsAll.length}`);
      continue;
    }
    const { done, value } = raced.r;
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const block of parts) {
      const dataLine = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('');
      if (!dataLine || dataLine === '[DONE]') continue;
      try {
        await handleEvent(JSON.parse(dataLine));
      } catch {
        /* ignore */
      }
    }
    if (finished || lastError) break;
    pending = reader.read();
  }
  try {
    reader.cancel();
  } catch {
    /* ignore */
  }

  const skillList = [...skills];
  const missingSkills = (c.skill_expect || []).filter(
    (k) => !skillList.some((s) => s.includes(k))
  );
  const craft = craftFlags(opsAll);
  const ok = !lastError && opsAll.length > 0;
  const row = {
    id: c.id,
    ok,
    ms: Date.now() - t0,
    taskId,
    skills: skillList,
    missingSkills,
    opsCount: opsAll.length,
    opsSummary: summarizeOps(opsAll),
    craftFlags: craft.flags,
    iconOps: craft.iconOps,
    emojiTextOps: craft.emojiText,
    opNames: craft.names,
    review,
    replyPreview: tokens.slice(0, 240),
    error: lastError,
  };
  console.log(`=== ${c.id} done ===`);
  console.log(JSON.stringify({ id: row.id, ok: row.ok, ms: row.ms, ops: row.opsCount, skills: row.skills, missing: row.missingSkills, craft: row.craftFlags, icons: row.iconOps, error: row.error }));
  return row;
}

const results = [];
for (const c of cases) {
  results.push(await runCase(c));
}
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
fs.writeFileSync(
  OUT,
  JSON.stringify({ startedAt: new Date().toISOString(), api: API, pass, fail, results }, null, 2)
);
console.log(`\nWrote ${OUT} pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
