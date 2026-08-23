/**
 * Design Agent Eval (Gate A quality track — not load).
 *
 * Usage (API up, token in .tmp-token.txt or EVAL_TOKEN / E2E_TOKEN):
 *   npm run eval:agent
 *   npm run eval:agent -- poster banner
 *   npm run eval:agent -- --v3-tasks
 *   npm run eval:compare
 *   npm run eval:agent -- --system
 *   npm run eval:agent -- poster --ask
 *   npm run eval:agent -- poster --paint-mode=ops
 *   npm run eval:agent -- poster --paint-mode=img_layers
 *
 * Env: EVAL_API, EVAL_TOKEN, EVAL_CONCURRENCY, EVAL_CASE_MS, EVAL_OUT, EVAL_SUITE,
 *      EVAL_INTERACTION_MODE (agent|ask), EVAL_PAINT_MODE (ops|img_layers)
 *
 * System issues → prompt packs; design issues → skills.
 * Load / concurrency → perf/k6 (docs/quality-gates.md).
 * Prefer cloud API stack (MySQL + platform catalog), not desktop-local sidecar.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(path.dirname(here));
const API = (process.env.EVAL_API || process.env.E2E_API || 'http://127.0.0.1:8000').replace(
  /\/$/,
  ''
);
const suitePath =
  process.env.EVAL_SUITE ||
  path.join(here, 'suite.json');
const rubric = JSON.parse(fs.readFileSync(path.join(here, 'rubric.json'), 'utf8'));

function clampEvalScores(raw) {
  const caps = rubric.caps || {};
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, cap] of Object.entries(caps)) {
    const n = Number(src[key] ?? 0);
    const v = Number.isFinite(n) ? Math.round(n) : 0;
    out[key] = Math.max(0, Math.min(Number(cap) || 0, v));
  }
  return out;
}

function sumEvalScores(scores) {
  return Object.keys(rubric.caps || {}).reduce((acc, key) => acc + (Number(scores?.[key]) || 0), 0);
}

function evalBand(total) {
  const rebuildBelow = Number(rubric.gates?.rebuild_below ?? 70);
  const passAt = Number(rubric.gates?.pass_at ?? 90);
  if (total < rebuildBelow) return 'rebuild';
  if (total < passAt) return 'repair';
  return 'pass';
}

function scoreCritique(ev) {
  const scores = clampEvalScores(ev?.scores);
  const hasDim = Object.values(scores).some((v) => v > 0);
  let total = null;
  if (hasDim) {
    total = sumEvalScores(scores);
  } else if (Number.isFinite(Number(ev?.total))) {
    total = Math.round(Number(ev.total));
  }
  const action = total == null ? ev?.review_action || null : evalBand(total);
  return {
    ok: ev?.ok,
    source: ev?.source || ev?.agent,
    issues: (ev?.issues || []).slice(0, 5),
    weaknesses: (ev?.weaknesses || []).slice(0, 5),
    market_gap: ev?.market_gap,
    scores: hasDim ? scores : undefined,
    total,
    review_action: action,
    runtime_total: ev?.total ?? null,
    runtime_action: ev?.review_action || null,
  };
}

function loadV3Tasks() {
  const dir = path.join(here, 'tasks');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))
    .map((task) => ({
      id: task.id,
      skill_expect: [task.skill, ...(task.helpers || [])].filter(Boolean),
      prompt: task.prompt,
      family: task.family,
    }));
}

function readToken() {
  const env = (process.env.EVAL_TOKEN || process.env.E2E_TOKEN || '').trim();
  if (env) return env;
  const p = path.join(root, '.tmp-token.txt');
  if (!fs.existsSync(p)) {
    console.error('Missing EVAL_TOKEN / E2E_TOKEN or .tmp-token.txt');
    process.exit(1);
  }
  return fs.readFileSync(p, 'utf8').trim();
}

const token = readToken();
const suite = JSON.parse(fs.readFileSync(suitePath, 'utf8'));

const argv = process.argv.slice(2);
const wantSystem = argv.includes('--system');
const wantV3Tasks = argv.includes('--v3-tasks');
const wantAsk =
  argv.includes('--ask') ||
  String(process.env.EVAL_INTERACTION_MODE || '').trim().toLowerCase() === 'ask';
function parsePaintMode() {
  const fromArg = argv.find((a) => a.startsWith('--paint-mode='));
  const raw = (
    (fromArg ? fromArg.split('=')[1] : '') ||
    process.env.EVAL_PAINT_MODE ||
    'ops'
  )
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (raw === 'img_layers') {
    return 'img_layers';
  }
  return 'ops';
}
const paintMode = parsePaintMode();
const interactionMode = wantAsk ? 'ask' : 'agent';
const modeTag = wantAsk ? 'ask' : paintMode === 'img_layers' ? 'img_layers' : 'ops';
const outPath =
  process.env.EVAL_OUT ||
  path.join(root, `.tmp-design-agent-eval-${modeTag}.json`);
const only = new Set(
  argv.filter((a) => a && !a.startsWith('--') && !a.startsWith('--paint-mode'))
);

const pool = wantV3Tasks
  ? loadV3Tasks()
  : wantSystem
    ? suite.system_cases || []
    : suite.cases || [];
const cases = pool.filter((c) => !only.size || only.has(c.id));
if (!cases.length) {
  console.error(`No cases selected (system=${wantSystem}, v3=${wantV3Tasks}, only=[${[...only]}])`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function synthSceneFromOps(ops, round) {
  const frames = [];
  const nodes = [];
  let fid = `eval-frame-${round}`;
  let w = 1080;
  let h = 1920;
  for (const op of ops) {
    const name = String(op.name || '');
    const args = op.args || {};
    if (name === 'create_frame' || name === 'ensure_frame') {
      fid = String(args.id || args.frame_id || fid);
      w = Number(args.width || w) || w;
      h = Number(args.height || h) || h;
    }
  }
  frames.push({ id: fid, name: 'Stress', width: w, height: h });
  let i = 0;
  for (const op of ops) {
    const name = String(op.name || '');
    const args = op.args || {};
    if (!name.includes('create') && !name.includes('add') && name !== 'update_node') continue;
    i += 1;
    const id = String(args.id || args.node_id || `n${round}_${i}`);
    const key = String(args.key || args.type || (name.includes('text') ? 'text' : 'rect'));
    nodes.push({
      id,
      key,
      frame_id: fid,
      x: Number(args.x ?? 40 + (i % 4) * 20),
      y: Number(args.y ?? 40 + i * 24),
      width: Number(args.width ?? 200),
      height: Number(args.height ?? 40),
      attrs: {
        ...(args.fill ? { fill: args.fill } : { fill: '#334155' }),
        ...(args.text ? { text: String(args.text) } : {}),
        ...(args.src ? { src: String(args.src) } : {}),
      },
    });
  }
  if (!nodes.length) {
    nodes.push({
      id: `placeholder-${round}`,
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

async function postScene(taskId, body) {
  const res = await fetch(`${API}/api/v1/design/run/${encodeURIComponent(taskId)}/scene`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`scene ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

function summarizeOps(ops) {
  return (ops || []).map((o) => {
    const a = o.args || {};
    const bits = [o.name || '?'];
    if (a.key) bits.push(a.key);
    if (a.text) bits.push(JSON.stringify(String(a.text).slice(0, 40)));
    if (a.fill) bits.push(String(a.fill).slice(0, 24));
    return bits.join(' ');
  });
}

/** Soft craft signals for skill regressions (do not replace hard ok). */
function craftFlags(c, opsAll) {
  const flags = [];
  const ops = opsAll || [];
  const names = ops.map((o) => String(o.name || ''));
  const emojiRe =
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  let emojiText = 0;
  let iconOps = 0;
  let iconMissingSvg = 0;
  for (const o of ops) {
    const n = String(o.name || '');
    const a = o.args || {};
    if (n === 'create_icon' || n === 'create_svg') {
      iconOps += 1;
      if (n === 'create_icon' && !String(a.svg || '').trim()) iconMissingSvg += 1;
    }
    if (n === 'create_shape' && (a.path || a.d || String(a.shapeType || '') === 'path')) {
      iconOps += 1;
    }
    if (n === 'create_text' && emojiRe.test(String(a.text || ''))) emojiText += 1;
  }
  if (emojiText > 0) flags.push(`emoji_text_ops:${emojiText}`);
  if (iconMissingSvg > 0) flags.push(`create_icon_empty_svg:${iconMissingSvg}`);
  const wantsIcons = (c.skill_expect || []).some((k) =>
    ['icon_set', 'mobile_app_ui', 'dashboard_ui'].includes(k)
  );
  if (wantsIcons && iconOps === 0 && ops.length > 0) {
    flags.push('no_vector_icon_ops');
  }
  if ((c.id === 'icon_set' || (c.skill_expect || []).includes('icon_set')) && iconOps < 4) {
    flags.push(`few_icon_marks:${iconOps}`);
  }
  return { flags, iconOps, emojiText, names: [...new Set(names)].slice(0, 24) };
}

function caseOk(c, { lastError, finished, opsAll, tokens, events, proposedOps, choiceUi }) {
  if (lastError) return false;
  const types = new Set((events || []).map((e) => e.type));
  if (types.has('error')) return false;
  const expect = new Set(c.expect || []);
  const askLane =
    wantAsk ||
    expect.has('ask_or_defaults') ||
    expect.has('canvas_or_ask');
  // Ask: propose+choice_ui / clarify is success; applied tool_ops optional.
  if (askLane) {
    if (types.has('paused') && !finished) {
      return Boolean(choiceUi || (proposedOps && proposedOps.length) || (tokens && tokens.length));
    }
    return Boolean(
      finished &&
        (opsAll.length > 0 ||
          (proposedOps && proposedOps.length > 0) ||
          choiceUi ||
          (tokens && tokens.length > 0))
    );
  }
  if (types.has('paused')) return false;
  // System / chat cases may finish with no canvas ops.
  if (expect.has('chat_or_refuse_paint') || expect.has('no_crash')) {
    return Boolean(finished);
  }
  // Category craft / img_layers: require tool_ops.
  if (Array.isArray(c.skill_expect) && c.skill_expect.length) {
    return Boolean(finished && opsAll.length > 0);
  }
  return Boolean(finished || opsAll.length || (tokens && tokens.length > 0));
}

async function runCase(c) {
  const t0 = Date.now();
  const events = [];
  const skills = new Set();
  const activity = [];
  let opsAll = [];
  let taskId = null;
  let lastError = null;
  let review = null;
  let finished = null;
  let tokens = '';
  let proposedOps = [];
  let choiceUi = null;

  const body = {
    run_mode: 'agent',
    interaction_mode: interactionMode,
    paint_mode: paintMode,
    prompt: c.prompt,
    user_selected_model: 'auto',
    project_id: `eval-${modeTag}-${c.id}`,
    session_id: `eval-sess-${modeTag}-${c.id}-${Date.now()}`,
    canvas_size: '1080x1920',
  };

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
    const t = await res.text();
    throw new Error(`run ${res.status}: ${t.slice(0, 400)}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + Number(process.env.EVAL_CASE_MS || 420_000);

  async function handleEvent(ev) {
    const type = ev?.type;
    if (!type) return;
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const extra =
      ev.skill_key || ev.key || (type === 'activity' ? ev.detail : '') || ev.message || '';
    console.log(`  [${dt}s] ${type}${extra ? ` ${String(extra).slice(0, 80)}` : ''}`);
    events.push({ type, t: Date.now() - t0, ...(ev.skill_key ? { skill_key: ev.skill_key } : {}) });
    if (ev.task_id) taskId = ev.task_id;
    if (type === 'skill_start' || type === 'skill_done') {
      const k = ev.skill_key || ev.key || ev.name;
      if (k) skills.add(String(k));
    }
    if (type === 'activity') {
      const detail = String(ev.detail || ev.summary || '').slice(0, 160);
      activity.push({
        id: ev.id,
        kind: ev.kind,
        status: ev.status,
        detail,
      });
      for (const expect of c.skill_expect || []) {
        if (detail.includes(expect)) skills.add(expect);
      }
    }
    if (type === 'tool_ops') {
      const ops = Array.isArray(ev.ops) ? ev.ops : [];
      opsAll = opsAll.concat(ops);
    }
    if (type === 'scene_feedback_request') {
      const tid = ev.task_id || taskId;
      const round = Number(ev.round || 0);
      const synth = synthSceneFromOps(opsAll, round);
      const op_results = (opsAll.length ? opsAll : [{}]).map((op, idx) => ({
        op_id: String(op.op_id || `op-${idx}`),
        name: String(op.name || 'noop'),
        ok: true,
      }));
      await postScene(tid, {
        round,
        ...synth,
        op_results,
      });
    }
    if (type === 'token') tokens += String(ev.text || '');
    if (type === 'critique_done') {
      review = scoreCritique(ev);
    }
    if (type === 'error') lastError = String(ev.message || ev.detail || JSON.stringify(ev)).slice(0, 400);
    if (type === 'paused') {
      // Ask clarify/propose may pause waiting for chips — not a hard fail on ask lane.
      if (!wantAsk) {
        lastError = String(ev.message || ev.detail || ev.reason || 'paused').slice(0, 400);
      }
      if (ev.choice_ui) choiceUi = ev.choice_ui;
      if (Array.isArray(ev.proposed_ops)) proposedOps = ev.proposed_ops;
      finished = finished || ev;
    }
    if (type === 'result' || type === 'done' || type === 'finish') {
      finished = ev;
      if (Array.isArray(ev.proposed_ops)) proposedOps = ev.proposed_ops;
      if (ev.choice_ui) choiceUi = ev.choice_ui;
    }
  }

  let lastBeat = Date.now();
  let pending = reader.read();
  while (Date.now() < deadline) {
    const raced = await Promise.race([
      pending.then((r) => ({ kind: 'chunk', r })),
      sleep(15_000).then(() => ({ kind: 'tick' })),
    ]);
    if (raced.kind === 'tick') {
      console.log(
        `  … waiting ${(Date.now() - t0) / 1000 | 0}s events=${events.length} ops=${opsAll.length}`
      );
      if (
        Date.now() - lastBeat > 180_000 &&
        events.length > 0 &&
        !opsAll.length &&
        !(c.expect || []).some((e) =>
          ['chat_or_refuse_paint', 'ask_or_defaults', 'no_crash'].includes(e)
        )
      ) {
        lastError = 'stalled >180s after events with no tool_ops';
        break;
      }
      continue;
    }
    const { done, value } = raced.r;
    if (done) break;
    pending = reader.read();
    lastBeat = Date.now();
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const block of parts) {
      const dataLines = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim());
      if (!dataLines.length) continue;
      const raw = dataLines.join('\n');
      if (raw === '[DONE]') {
        finished = finished || { type: 'done' };
        break;
      }
      try {
        await handleEvent(JSON.parse(raw));
      } catch (e) {
        lastError = `parse/handle: ${e?.message || e}`;
      }
    }
    if (finished || lastError) break;
  }
  if (!finished && !lastError && Date.now() >= deadline) {
    lastError = `timeout after ${Math.round((Date.now() - t0) / 1000)}s`;
  }

  try {
    reader.cancel();
  } catch {
    /* ignore */
  }

  // Optional follow-up after Stop (system_cases with followup_after_stop).
  if (c.followup_after_stop && !lastError) {
    // Soft-stop is browser-only; for SSE we just run the follow-up as a second turn.
    const follow = { ...c, id: `${c.id}__followup`, prompt: c.followup_after_stop };
    delete follow.followup_after_stop;
    const second = await runCase(follow);
    return {
      id: c.id,
      ok: second.ok,
      ms: Date.now() - t0,
      followup: second,
      error: second.error || null,
    };
  }

  const skillList = [...skills];
  const missingSkills = (c.skill_expect || []).filter((k) => !skillList.some((s) => s.includes(k)));
  const ok = caseOk(c, {
    lastError,
    finished,
    opsAll,
    tokens,
    events,
    proposedOps,
    choiceUi,
  });
  const craft = craftFlags(c, opsAll);
  return {
    id: `${c.id}@${modeTag}`,
    caseId: c.id,
    mode: modeTag,
    interaction_mode: interactionMode,
    paint_mode: paintMode,
    ok,
    ms: Date.now() - t0,
    taskId,
    skills: skillList,
    skill_expect: c.skill_expect,
    missingSkills,
    opsCount: opsAll.length,
    proposedOpsCount: proposedOps.length,
    hasChoiceUi: Boolean(choiceUi),
    opsSummary: summarizeOps(opsAll.length ? opsAll : proposedOps).slice(0, 40),
    craftFlags: craft.flags,
    iconOps: craft.iconOps,
    emojiTextOps: craft.emojiText,
    opNames: craft.names,
    review,
    activityTail: activity.slice(-12),
    replyPreview: tokens.slice(0, 240),
    error: lastError,
    eventTypes: events.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1;
      return acc;
    }, {}),
  };
}

const CONCURRENCY = Math.max(1, Number(process.env.EVAL_CONCURRENCY || 2) || 2);

function logCaseRow(row) {
  console.log(
    JSON.stringify(
      {
        id: row.id,
        ok: row.ok,
        ms: row.ms,
        ops: row.opsCount,
        skills: row.skills,
        missing: row.missingSkills,
        craft: row.craftFlags,
        icons: row.iconOps,
        review: row.review?.review_action || row.review?.ok,
        error: row.error,
      },
      null,
      0
    )
  );
}

async function runCaseLogged(c) {
  process.stdout.write(`\n=== ${c.id} start ===\n`);
  try {
    const row = await runCase(c);
    process.stdout.write(`=== ${c.id} done ===\n`);
    logCaseRow(row);
    return row;
  } catch (e) {
    const row = { id: c.id, ok: false, error: String(e?.message || e) };
    process.stdout.write(`=== ${c.id} done ===\n`);
    logCaseRow(row);
    return row;
  }
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

console.log(
  `eval pool=${wantV3Tasks ? 'v3_tasks' : wantSystem ? 'system_cases' : 'cases'} n=${cases.length} ids=${cases
    .map((c) => c.id)
    .join(',')} api=${API} mode=${modeTag} interaction=${interactionMode} paint=${paintMode} concurrency=${CONCURRENCY}`
);
const results = await mapPool(cases, CONCURRENCY, (c) => runCaseLogged(c));

const summary = {
  startedAt: new Date().toISOString(),
  api: API,
  pool: wantV3Tasks ? 'v3_tasks' : wantSystem ? 'system_cases' : 'cases',
  mode: modeTag,
  interaction_mode: interactionMode,
  paint_mode: paintMode,
  concurrency: CONCURRENCY,
  rubric: {
    caps: rubric.caps,
    gates: rubric.gates,
  },
  pass: results.filter((r) => r.ok).length,
  fail: results.filter((r) => !r.ok).length,
  results,
};
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
const resultsDir = path.join(here, 'results');
fs.mkdirSync(resultsDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.writeFileSync(path.join(resultsDir, `${stamp}.json`), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(resultsDir, 'latest.json'), JSON.stringify(summary, null, 2));
console.log(`\nWrote ${outPath} pass=${summary.pass} fail=${summary.fail}`);
process.exit(summary.fail ? 1 : 0);
