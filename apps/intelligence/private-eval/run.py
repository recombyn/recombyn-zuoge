#!/usr/bin/env python3
"""Private-eval runner — local only (never public CI).

Loads:
  - private-eval/fixtures/smoke.json when --smoke
  - private-eval/fixtures/ab_pack.json when --ab
  - private-eval/datasets/*.json (gitignored closed corpora)

Calls in-process ``handle_method`` (private/cloud engine surface).
Writes private-eval/results/latest.json (+ ab_latest.md when --ab).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

DATASETS = ROOT / "private-eval" / "datasets"
FIXTURES = ROOT / "private-eval" / "fixtures"
RESULTS = ROOT / "private-eval" / "results"

# Extreme Decide hops (Max intensity). Accumulated across the stack.
_AB_STACK: tuple[str, ...] = (
    "research",
    "strategy",
    "propose_candidates",
    "tournament",
    "swarm_direction",
    "simulate",
    "counterfactual",
    "retrieve_memory",
)

_ACCUM_SLOT: dict[str, str] = {
    "research": "design_research",
    "strategy": "design_strategy",
    "propose_candidates": "design_candidates",
    "tournament": "design_tournament",
    "swarm_direction": "design_swarm",
    "simulate": "design_simulation",
    "counterfactual": "design_counterfactual",
    "retrieve_memory": "design_memory",
}


def _load_json_tasks(path: Path) -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"skip {path.name}: {exc}")
        return tasks
    if isinstance(raw, list):
        rows = raw
    elif isinstance(raw, dict) and isinstance(raw.get("tasks"), list):
        rows = raw["tasks"]
    else:
        return tasks
    for item in rows:
        if isinstance(item, dict):
            item.setdefault("suite", path.stem)
            tasks.append(item)
    return tasks


def _load_tasks(*, smoke: bool, ab: bool) -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    if smoke:
        smoke_path = FIXTURES / "smoke.json"
        if smoke_path.is_file():
            tasks.extend(_load_json_tasks(smoke_path))
        return tasks
    if ab:
        ab_path = FIXTURES / "ab_pack.json"
        if ab_path.is_file():
            tasks.extend(_load_json_tasks(ab_path))
        return tasks
    if not DATASETS.is_dir():
        return tasks
    for path in sorted(DATASETS.glob("*.json")):
        if path.name.startswith("."):
            continue
        tasks.extend(_load_json_tasks(path))
    return tasks


def _fingerprint(payload: dict[str, Any] | None) -> str:
    if not isinstance(payload, dict):
        return ""
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def _run_one(method: str, body: dict[str, Any]) -> dict[str, Any]:
    from recombyn_intelligence_service.providers import handle_method

    t0 = time.time()
    try:
        payload = handle_method(method, body)
        ok = isinstance(payload, dict) and bool(payload)
        err = None
    except Exception as exc:
        payload = None
        ok = False
        err = str(exc)
    return {
        "method": method,
        "ok": ok,
        "latencyMs": int((time.time() - t0) * 1000),
        "error": err,
        "keys": sorted(payload.keys()) if isinstance(payload, dict) else [],
        "fingerprint": _fingerprint(payload if isinstance(payload, dict) else None),
        "payload": payload if isinstance(payload, dict) else None,
    }


def _normalize_task_body(body: dict[str, Any]) -> dict[str, Any]:
    return dict(body)


def _merge_stack_body(
    base: dict[str, Any], prior: dict[str, Any], method: str
) -> dict[str, Any]:
    """One-prior merge (smoke stack). Prefer ``_run_accum_stack`` for AB."""
    body = dict(base)
    if method == "strategy" and prior:
        body["design_research"] = prior
    if method == "propose_candidates" and prior:
        body["design_strategy"] = prior
    if method == "tournament" and prior:
        if isinstance(prior.get("candidates"), list):
            body["design_candidates"] = prior
        elif prior.get("composition_strategy"):
            body["design_strategy"] = prior
    return body


def _run_accum_stack(
    base: dict[str, Any], stack: list[str]
) -> tuple[bool, list[dict[str, Any]], dict[str, Any]]:
    """Run hops while accumulating design_* slots (Max-intensity card)."""
    state = _normalize_task_body(dict(base))
    flags = dict(state.get("flags") or {}) if isinstance(state.get("flags"), dict) else {}
    hop_rows: list[dict[str, Any]] = []
    ok_all = True
    for hop in stack:
        method = str(hop).strip()
        if not method:
            continue
        body = dict(state)
        body["flags"] = dict(flags)
        row = _run_one(method, body)
        hop_rows.append({k: v for k, v in row.items() if k != "payload"})
        if not row["ok"]:
            ok_all = False
            break
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        slot = _ACCUM_SLOT.get(method)
        if slot and payload:
            state[slot] = payload
            if method == "retrieve_memory":
                notes = list(payload.get("notes") or [])
                state["memory_notes"] = [str(x) for x in notes if str(x).strip()][:16]
        state["flags"] = flags
    return ok_all, hop_rows, state


def _brief_lines(task_id: str, prompt: str, state: dict[str, Any], hops: list[dict[str, Any]]) -> list[str]:
    """Human-readable Decide-facing card for product A/B paste."""
    res = state.get("design_research") if isinstance(state.get("design_research"), dict) else {}
    strat = state.get("design_strategy") if isinstance(state.get("design_strategy"), dict) else {}
    tour = state.get("design_tournament") if isinstance(state.get("design_tournament"), dict) else {}
    swarm = state.get("design_swarm") if isinstance(state.get("design_swarm"), dict) else {}
    sim = state.get("design_simulation") if isinstance(state.get("design_simulation"), dict) else {}
    cf = (
        state.get("design_counterfactual")
        if isinstance(state.get("design_counterfactual"), dict)
        else {}
    )
    mem = state.get("design_memory") if isinstance(state.get("design_memory"), dict) else {}

    lines = [
        f"## {task_id}",
        f"prompt: {prompt[:160]}",
        "",
        "### research",
        f"- niches: {', '.join(str(x) for x in list(res.get('niches') or [])[:4]) or '-'}",
        f"- paint_checks: {', '.join(str(x) for x in list(res.get('paint_checks') or [])[:5]) or '-'}",
        f"- anti: {len(list(res.get('anti_category_strategy') or []))}",
        "",
        "### strategy",
        f"- thesis: {str(strat.get('visual_thesis') or '')[:120] or '-'}",
        f"- directives: {len(list(strat.get('decide_directives') or []))}",
        "",
        "### candidates",
        f"- primary: {(state.get('design_candidates') or {}).get('primary_id') if isinstance(state.get('design_candidates'), dict) else '-'} "
        f"({(state.get('design_candidates') or {}).get('primary_reason') if isinstance(state.get('design_candidates'), dict) else '-'})",
        "",
        "### tournament",
        f"- winner: {tour.get('winner_id') or '-'} · rubric: {tour.get('rubric_id') or '-'}",
        "",
        "### swarm",
    ]
    for d in list(swarm.get("final_direction") or [])[:4]:
        lines.append(f"- {d}")
    if not swarm.get("final_direction"):
        lines.append("- -")
    att = sim.get("attention") if isinstance(sim.get("attention"), dict) else {}
    lines.extend(
        [
            "",
            "### simulate",
            f"- hero={round(float(att.get('hero') or 0)*100)}% "
            f"cta={round(float(att.get('cta') or 0)*100)}% "
            f"warnings={len(list(sim.get('warnings') or []))}",
            "",
            "### counterfactual",
            f"- recommended: {cf.get('recommended_id') or cf.get('selected_id') or '-'}",
            "",
            "### memory",
        ]
    )
    for note in list(mem.get("notes") or [])[:3]:
        lines.append(f"- {note}")
    if not mem.get("notes"):
        lines.append("- -")
    lines.extend(["", "### hop fingerprints"])
    for hop in hops:
        lines.append(
            f"- {hop.get('method')}: ok={hop.get('ok')} "
            f"fp={hop.get('fingerprint')} {hop.get('latencyMs')}ms"
        )
    lines.append("")
    return lines


def _write_ab_markdown(cards: list[str]) -> Path:
    path = RESULTS / "ab_latest.md"
    header = [
        "# Private intelligence A/B brief",
        "",
        "Compare against product runs with `RECOMBYN_INTELLIGENCE_MODE=local` (BasicLocal)",
        "vs `cloud` (this service). Paste matching prompt cards side-by-side.",
        "",
    ]
    path.write_text("\n".join(header + cards), encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="Private intelligence eval runner")
    parser.add_argument("--limit", type=int, default=0, help="Max tasks (0 = all)")
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="Use committed fixtures/smoke.json (no gitignored datasets)",
    )
    parser.add_argument(
        "--ab",
        action="store_true",
        help="Run fixtures/ab_pack.json full Max stack → results/ab_latest.md",
    )
    parser.add_argument(
        "--keep-payloads",
        action="store_true",
        help="Include truncated payload snippets in results JSON",
    )
    args = parser.parse_args()

    tasks = _load_tasks(smoke=bool(args.smoke), ab=bool(args.ab))
    if args.limit and args.limit > 0:
        tasks = tasks[: args.limit]

    RESULTS.mkdir(parents=True, exist_ok=True)
    if not tasks:
        out = {
            "status": "skipped",
            "reason": (
                "no fixtures (use --smoke / --ab) and no datasets under "
                "private-eval/datasets"
            ),
            "ts": time.time(),
            "results": [],
        }
        (RESULTS / "latest.json").write_text(
            json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print("private-eval: no tasks — wrote results/latest.json (skipped)")
        return 0

    results = []
    ab_cards: list[str] = []
    for task in tasks:
        method = str(task.get("method") or "research").strip()
        body = _normalize_task_body(
            task.get("body") if isinstance(task.get("body"), dict) else {}
        )
        expect_keys = [
            str(k) for k in (task.get("expect_keys") or []) if str(k).strip()
        ]
        stack = task.get("stack") if isinstance(task.get("stack"), list) else None
        task_id = str(task.get("id") or task.get("name") or "task")
        prompt = str(body.get("prompt") or "")

        # --ab tasks default to full Max stack when method is ab / stack omitted.
        if args.ab and (method in ("ab", "stack") or not stack):
            use_stack = [str(x) for x in (stack or _AB_STACK)]
            t0 = time.time()
            ok_all, hop_rows, state = _run_accum_stack(body, use_stack)
            entry = {
                "id": task_id,
                "suite": task.get("suite") or "ab",
                "method": "ab_stack",
                "stack": use_stack,
                "ok": ok_all,
                "latencyMs": int((time.time() - t0) * 1000),
                "hops": hop_rows,
                "expect_keys_ok": True,
                "fingerprints": {
                    str(h.get("method")): h.get("fingerprint") for h in hop_rows
                },
            }
            results.append(entry)
            ab_cards.extend(_brief_lines(task_id, prompt, state, hop_rows))
            continue

        if method == "stack" and stack:
            # Prefer accum merge so longer stacks keep research→… context.
            t0 = time.time()
            ok_all, hop_rows, _state = _run_accum_stack(
                body, [str(x) for x in stack]
            )
            entry = {
                "id": task_id,
                "suite": task.get("suite"),
                "method": "stack",
                "stack": [str(x) for x in stack],
                "ok": ok_all,
                "latencyMs": int((time.time() - t0) * 1000),
                "hops": hop_rows,
                "expect_keys_ok": True,
            }
            results.append(entry)
            continue

        row = _run_one(method, body)
        keys = set(row.get("keys") or [])
        expect_ok = all(k in keys for k in expect_keys) if expect_keys else True
        entry = {
            "id": task_id,
            "suite": task.get("suite"),
            "method": method,
            "ok": bool(row["ok"] and expect_ok),
            "latencyMs": row["latencyMs"],
            "error": row["error"],
            "keys": row["keys"],
            "fingerprint": row["fingerprint"],
            "expect_keys": expect_keys,
            "expect_keys_ok": expect_ok,
        }
        if args.keep_payloads and isinstance(row.get("payload"), dict):
            entry["payload_preview"] = {
                k: row["payload"].get(k) for k in list(row["payload"].keys())[:12]
            }
        results.append(entry)

    passed = sum(1 for r in results if r["ok"])
    out = {
        "status": "ok",
        "mode": "ab" if args.ab else ("smoke" if args.smoke else "datasets"),
        "ts": time.time(),
        "total": len(results),
        "passed": passed,
        "failed": len(results) - passed,
        "results": results,
    }
    (RESULTS / "latest.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if args.ab and ab_cards:
        md_path = _write_ab_markdown(ab_cards)
        (RESULTS / "ab_latest.json").write_text(
            json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(
            f"private-eval: {passed}/{len(results)} passed → "
            f"results/latest.json + {md_path.name}"
        )
    else:
        print(f"private-eval: {passed}/{len(results)} passed → results/latest.json")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
