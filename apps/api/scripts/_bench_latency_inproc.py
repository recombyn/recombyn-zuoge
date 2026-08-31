"""In-process Design Agent latency bench across design_intensity modes.

Run from apps/api:
  .venv/Scripts/python.exe scripts/_bench_latency_inproc.py
"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# scripts/ → api/ → apps/ → repo root
REPO_ROOT = Path(__file__).resolve().parents[3]
OUT_PATH = REPO_ROOT / ".tmp-bench-design-latency-intensity.json"

INTENSITY_LABEL = {
    "light": "快速执行",
    "medium": "标准设计",
    "high": "深度设计",
    "extreme": "专业审校",
}

BASE_CASES = [
    {
        "id": "chat",
        "label": "闲聊",
        "prompt": "你好，随便聊聊，不用改画布。今天适合做什么设计？",
    },
    {
        "id": "lean_edit",
        "label": "轻量改动",
        "prompt": "把标题文字颜色改成蓝色 #2563EB，只改 n-title，不要新建画板。",
        "scene_nodes": [
            {
                "id": "n-title",
                "key": "text",
                "frame_id": "f1",
                "x": 80,
                "y": 120,
                "width": 400,
                "height": 64,
                "attrs": {"text": "夏日特卖", "fill": "#111111", "fontSize": 48},
            },
        ],
        "scene_frames": [{"id": "f1", "name": "海报", "width": 1080, "height": 1920}],
        "focus_frame_id": "f1",
    },
    {
        "id": "login_page",
        "label": "登录页",
        "prompt": (
            "设计一个移动端登录页：手机号+验证码、主按钮「登录」、"
            "次要链接「忘记密码」，简洁现代，可直接落笔。"
        ),
    },
]


def _synth(ops: list[dict], round_i: int) -> dict:
    """Build a minimal scene from emitted tool_ops for scene_feedback."""
    fid = f"bench-f-{round_i}"
    w, h = 1080, 1920
    nodes: list[dict] = []
    for i, op in enumerate(ops):
        name = str(op.get("name") or "")
        args = op.get("args") if isinstance(op.get("args"), dict) else {}
        if name in ("create_frame", "ensure_frame"):
            if args.get("id"):
                fid = str(args["id"])
            elif args.get("frame_id"):
                fid = str(args["frame_id"])
            if args.get("width"):
                w = int(args["width"])
            if args.get("height"):
                h = int(args["height"])
        if "create" not in name and name != "update_node":
            continue
        nid = args.get("id") or args.get("node_id")
        if not nid:
            nid = f"n{round_i}_{i}"
        nodes.append(
            {
                "id": str(nid),
                "key": str(args.get("key") or "rect"),
                "frame_id": fid,
                "x": float(args.get("x") or 0),
                "y": float(args.get("y") or 0),
                "width": float(args.get("width") or 100),
                "height": float(args.get("height") or 40),
                "attrs": {"fill": args.get("fill") or "#334155"},
            }
        )
    return {
        "scene_nodes": nodes,
        "scene_frames": [{"id": fid, "name": "Bench", "width": w, "height": h}],
    }


async def run_case(case: dict) -> dict:
    from app.services.design.runtime.design_run import design_stream
    from app.services.design.runtime.orchestrator import _platform_rules_with_profile
    from app.services.design.runtime.scene_feedback import publish_scene

    rules = _platform_rules_with_profile()
    model = "deepseek-chat"
    intensity = case["intensity"]
    t0 = time.time()
    marks: dict[str, float] = {}
    ops_all: list[dict] = []
    finished = None
    err = None
    task_id = None
    reply = ""

    def mark(name: str) -> None:
        marks.setdefault(name, round((time.time() - t0) * 1000))

    async for ev in design_stream(
        user_id="user_super_admin",
        mode="agent",
        prompt=case["prompt"],
        rules=rules,
        user_selected_model=model,
        canvas_id=None,
        canvas_size="1080x1920",
        scene=None,
        scene_nodes=list(case.get("scene_nodes") or []),
        scene_frames=list(case.get("scene_frames") or []),
        spatial_summary=None,
        focus_frame_id=case.get("focus_frame_id"),
        images=None,
        memory_in=None,
        session_id=f"bench-{case['id']}-{intensity}-{int(t0)}",
        project_id=f"bench-{case['id']}-{intensity}",
        hold=0,
        free_daily=True,
        t0=t0,
        reserve_hold_fn=lambda *a, **k: 0,
        settle_hold_fn=lambda *a, **k: 0,
        refund_hold_fn=lambda *a, **k: None,
        interaction_mode="agent",
        locale="zh-CN",
        design_intensity=intensity,
    ):
        if not isinstance(ev, dict):
            continue
        typ = str(ev.get("type") or "")
        if ev.get("task_id"):
            task_id = ev["task_id"]
        detail = str(ev.get("detail") or "")[:80]
        dt = round(time.time() - t0, 1)

        if typ in ("status", "activity", "stage", "decision"):
            print(f"  [{dt}s] {typ} {detail}")
            low = detail.lower()
            if "intent" in low:
                mark("intent_ms")
            if "decide" in low or "design" in low:
                mark("decide_ms")
            if "paint" in low:
                mark("paint_ms")
            continue

        if typ == "tool_ops":
            mark("first_ops_ms")
            ops = ev.get("ops") if isinstance(ev.get("ops"), list) else []
            ops_all.extend(o for o in ops if isinstance(o, dict))
            print(f"  [{dt}s] tool_ops x{len(ops)}")
            continue

        if typ == "scene_feedback_request":
            mark("scene_fb_ms")
            print(f"  [{dt}s] scene_feedback")
            tid = str(ev.get("task_id") or task_id or "")
            if not tid:
                err = "scene_feedback without task_id"
                break
            synth = _synth(ops_all, int(ev.get("round") or 0))
            await publish_scene(
                tid,
                synth["scene_nodes"],
                frames=synth["scene_frames"],
                op_results=[
                    {
                        "op_id": str(op.get("op_id") or f"op-{i}"),
                        "name": str(op.get("name") or "op"),
                        "ok": True,
                    }
                    for i, op in enumerate(ops_all)
                ],
                round_n=int(ev.get("round") or 0),
            )
            continue

        if typ == "token":
            mark("first_token_ms")
            reply += str(ev.get("text") or "")
            continue

        if typ in ("result", "done", "finish"):
            mark("done_ms")
            finished = typ
            if ev.get("reply"):
                reply = str(ev["reply"])[:160]
            print(f"  [{dt}s] {typ}")
            break

        if typ == "paused":
            msg = str(ev.get("message") or "")
            print(f"  [{dt}s] paused {msg[:120]}")
            if ev.get("interrupt_kind") == "error" or "Errno" in msg or "失败" in msg:
                err = msg or "paused_error"
            else:
                finished = "paused"
                reply = msg[:160]
            break

        if typ == "error":
            err = str(ev.get("message") or ev)
            print(f"  [{dt}s] error {err[:120]}")
            break

    ms = int((time.time() - t0) * 1000)
    return {
        "id": case["id"],
        "label": case["label"],
        "intensity": intensity,
        "intensity_label": INTENSITY_LABEL[intensity],
        "ok": bool(finished) and not err,
        "sec": round(ms / 1000, 1),
        "ms": ms,
        "ops": len(ops_all),
        "marks": marks,
        "error": err,
        "reply": reply,
        "model": model,
    }


def iter_matrix():
    for intensity in INTENSITY_LABEL:
        for base in BASE_CASES:
            yield {**base, "intensity": intensity}


async def main() -> None:
    results = []
    for case in iter_matrix():
        label = INTENSITY_LABEL[case["intensity"]]
        print(f"\n=== {case['label']} / {label} ({case['intensity']}) ===")
        try:
            r = await run_case(case)
        except Exception as e:  # noqa: BLE001
            r = {
                "id": case["id"],
                "label": case["label"],
                "intensity": case["intensity"],
                "intensity_label": label,
                "ok": False,
                "sec": 0,
                "ops": 0,
                "error": str(e),
            }
            print("FAIL", e)
        results.append(r)
        status = "OK" if r.get("ok") else "FAIL"
        print(
            f"=> {status} {r.get('sec')}s ops={r.get('ops')} "
            f"marks={r.get('marks')} err={str(r.get('error') or '')[:80]}"
        )

    OUT_PATH.write_text(
        json.dumps(
            {"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "results": results},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print("\n===== SUMMARY (case × intensity) =====")
    print(f"{'用例':<8} {'模式':<10} {'耗时':>7} {'ops':>4}  status")
    for r in results:
        status = "ok" if r.get("ok") else "FAIL"
        snippet = (r.get("error") or r.get("reply") or "")[:50]
        print(
            f"{r['label']:<8} {r['intensity_label']:<10} "
            f"{r.get('sec', 0):>6}s  {r.get('ops', 0):>3}  {status}  {snippet}"
        )
    print("wrote", OUT_PATH)


if __name__ == "__main__":
    asyncio.run(main())
