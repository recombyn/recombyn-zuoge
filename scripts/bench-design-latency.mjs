/**
 * Latency smoke: chat / lean edit / poster design against local Design Agent.
 * Usage: node scripts/bench-design-latency.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API = (process.env.EVAL_API || "http://127.0.0.1:8000").replace(/\/$/, "");
const token = (
  process.env.EVAL_TOKEN ||
  process.env.E2E_TOKEN ||
  fs.readFileSync(path.join(root, ".tmp-token.txt"), "utf8")
).trim();

const CASES = [
  {
    id: "chat",
    label: "闲聊",
    prompt: "你好，随便聊聊，不用改画布。今天适合做什么设计？",
    design_intensity: "light",
    canvas_size: "1080x1920",
    scene: null,
  },
  {
    id: "lean_edit",
    label: "轻量改动",
    prompt: "把标题文字改成蓝色，不要新建画板。",
    design_intensity: "light",
    canvas_size: "1080x1920",
    scene: {
      scene_nodes: [
        {
          id: "n-title",
          key: "text",
          frame_id: "f1",
          x: 80,
          y: 120,
          width: 400,
          height: 64,
          attrs: { text: "夏日特卖", fill: "#111111", fontSize: 48 },
        },
        {
          id: "n-bg",
          key: "rect",
          frame_id: "f1",
          x: 0,
          y: 0,
          width: 1080,
          height: 1920,
          attrs: { fill: "#ffffff" },
        },
      ],
      scene_frames: [{ id: "f1", name: "海报", width: 1080, height: 1920 }],
      focus_frame_id: "f1",
    },
  },
  {
    id: "poster",
    label: "海报设计",
    prompt:
      "设计一张竖版夏季促销海报：主标题「夏日特卖」，副标题「全场低至5折」，红白配色，简洁现代，可直接落笔。",
    design_intensity: "medium",
    canvas_size: "1080x1920",
    scene: null,
  },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function synthSceneFromOps(ops, round) {
  const frames = [];
  const nodes = [];
  let fid = `bench-frame-${round}`;
  let w = 1080;
  let h = 1920;
  for (const op of ops) {
    const name = String(op.name || "");
    const args = op.args || {};
    if (name === "create_frame" || name === "ensure_frame") {
      fid = String(args.id || args.frame_id || fid);
      w = Number(args.width || w) || w;
      h = Number(args.height || h) || h;
    }
  }
  frames.push({ id: fid, name: "Bench", width: w, height: h });
  let i = 0;
  for (const op of ops) {
    const name = String(op.name || "");
    const args = op.args || {};
    if (!name.includes("create") && name !== "update_node") continue;
    i += 1;
    nodes.push({
      id: String(args.id || args.node_id || `n${round}_${i}`),
      key: String(args.key || args.type || (name.includes("text") ? "text" : "rect")),
      frame_id: fid,
      x: Number(args.x ?? 40),
      y: Number(args.y ?? 40 + i * 24),
      width: Number(args.width ?? 200),
      height: Number(args.height ?? 40),
      attrs: {
        ...(args.fill ? { fill: args.fill } : { fill: "#334155" }),
        ...(args.text ? { text: String(args.text) } : {}),
      },
    });
  }
  if (!nodes.length) {
    nodes.push({
      id: `ph-${round}`,
      key: "rect",
      frame_id: fid,
      x: 0,
      y: 0,
      width: w,
      height: h,
      attrs: { fill: "#0f172a" },
    });
  }
  return { scene_nodes: nodes, scene_frames: frames };
}

async function postScene(taskId, body) {
  await fetch(`${API}/api/v1/design/run/${encodeURIComponent(taskId)}/scene`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function runOne(c) {
  const t0 = Date.now();
  const marks = {};
  const stages = [];
  let opsAll = [];
  let taskId = null;
  let finished = null;
  let lastError = null;
  let replyPreview = "";
  let tokens = "";

  const body = {
    run_mode: "agent",
    interaction_mode: "agent",
    paint_mode: "ops",
    prompt: c.prompt,
    // deepseek-reasoner (env default/auto) often fails IntentClassify structured output.
    user_selected_model: process.env.BENCH_MODEL || "deepseek-chat",
    design_intensity: c.design_intensity,
    locale: "zh-CN",
    project_id: `bench-latency-${c.id}`,
    session_id: `bench-sess-${c.id}-${Date.now()}`,
    canvas_size: c.canvas_size,
  };
  if (c.scene) {
    body.scene_nodes = c.scene.scene_nodes;
    body.scene_frames = c.scene.scene_frames;
    body.focus_frame_id = c.scene.focus_frame_id;
  }

  const res = await fetch(`${API}/api/v1/design/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const t = await res.text();
    throw new Error(`${c.id} HTTP ${res.status}: ${t.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + Number(process.env.BENCH_CASE_MS || 300_000);

  const mark = (name) => {
    if (marks[name] == null) marks[name] = Date.now() - t0;
  };

  async function onEvent(ev) {
    const type = String(ev?.type || "");
    if (!type) return;
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    if (ev.task_id) taskId = ev.task_id;
    if (type === "status" || type === "activity" || type === "stage") {
      const detail = String(ev.detail || ev.summary || ev.stage || ev.id || "").slice(0, 60);
      stages.push({ t: Date.now() - t0, type, detail });
      console.log(`  [${dt}s] ${type} ${detail}`);
      if (/intent/i.test(detail)) mark("intent");
      if (/decide|design_agent|thinking/i.test(detail)) mark("decide");
      if (/paint/i.test(detail)) mark("paint");
      if (/observe|review/i.test(detail)) mark("observe_or_review");
    } else if (type === "tool_ops") {
      mark("first_tool_ops");
      const ops = Array.isArray(ev.ops) ? ev.ops : [];
      opsAll = opsAll.concat(ops);
      console.log(`  [${dt}s] tool_ops x${ops.length}`);
    } else if (type === "token") {
      mark("first_token");
      tokens += String(ev.text || "");
    } else if (type === "scene_feedback_request") {
      mark("scene_feedback");
      console.log(`  [${dt}s] scene_feedback_request`);
      const synth = synthSceneFromOps(opsAll, Number(ev.round || 0));
      await postScene(ev.task_id || taskId, {
        round: Number(ev.round || 0),
        ...synth,
        op_results: (opsAll.length ? opsAll : [{}]).map((op, idx) => ({
          op_id: String(op.op_id || `op-${idx}`),
          name: String(op.name || "noop"),
          ok: true,
        })),
      });
    } else if (type === "result" || type === "done" || type === "finish") {
      mark("done");
      finished = ev;
      replyPreview = String(ev.reply || ev.message || ev.summary || tokens || "").slice(0, 120);
      console.log(`  [${dt}s] ${type}`);
    } else     if (type === "paused") {
      mark("paused");
      const msg = String(ev.message || ev.reason || "").slice(0, 200);
      // Error-parked runs are failures for latency measurement.
      if (ev.interrupt_kind === "error" || /Errno|失败|error|ValidationError|structured_output/i.test(msg)) {
        lastError = msg || "paused_error";
      } else {
        finished = ev;
      }
      console.log(`  [${dt}s] paused ${msg.slice(0, 80)}`);
    } else if (type === "error") {
      lastError = String(ev.message || ev.detail || JSON.stringify(ev)).slice(0, 240);
      console.log(`  [${dt}s] error ${lastError}`);
    } else if (["critique_done", "skill_start", "skill_done"].includes(type)) {
      console.log(`  [${dt}s] ${type}`);
    }
  }

  let pending = reader.read();
  while (Date.now() < deadline) {
    const raced = await Promise.race([
      pending.then((r) => ({ kind: "chunk", r })),
      sleep(20_000).then(() => ({ kind: "tick" })),
    ]);
    if (raced.kind === "tick") {
      console.log(`  … ${(Date.now() - t0) / 1000 | 0}s still running`);
      continue;
    }
    const { done, value } = raced.r;
    if (done) break;
    pending = reader.read();
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const block of parts) {
      const dataLines = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim());
      if (!dataLines.length) continue;
      const raw = dataLines.join("\n");
      if (raw === "[DONE]") {
        finished = finished || { type: "done" };
        mark("done");
        break;
      }
      try {
        await onEvent(JSON.parse(raw));
      } catch (e) {
        lastError = `parse: ${e.message || e}`;
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
  return {
    id: c.id,
    label: c.label,
    intensity: c.design_intensity,
    ok: Boolean(finished) && !lastError,
    ms,
    sec: Number((ms / 1000).toFixed(1)),
    marks,
    ops: opsAll.length,
    error: lastError,
    replyPreview,
  };
}

const results = [];
console.log(`API ${API}`);
for (const c of CASES) {
  console.log(`\n=== ${c.label} (${c.id}) intensity=${c.design_intensity} ===`);
  try {
    const r = await runOne(c);
    results.push(r);
    console.log(
      `=> ${r.ok ? "OK" : "FAIL"} ${r.sec}s ops=${r.ops} marks=${JSON.stringify(r.marks)}`
    );
  } catch (e) {
    console.error(`=> FAIL ${e.message || e}`);
    results.push({
      id: c.id,
      label: c.label,
      ok: false,
      ms: 0,
      sec: 0,
      error: String(e.message || e),
    });
  }
}

const out = path.join(root, ".tmp-bench-design-latency.json");
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log("\n===== SUMMARY =====");
for (const r of results) {
  console.log(
    `${r.label.padEnd(8)} ${String(r.sec).padStart(6)}s  ops=${String(r.ops ?? "-").padStart(3)}  ${r.ok ? "ok" : "FAIL"}  ${r.error || r.replyPreview || ""}`.slice(
      0,
      160
    )
  );
}
console.log(`wrote ${out}`);
