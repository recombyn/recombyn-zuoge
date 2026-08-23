"""Optional skill ``handler.py`` runner — returns tool_ops only (Phase C).

Opt-in via ``DESIGN_SKILL_OPS_RUNNER=true``. Handlers must export::

    def run(ctx: dict, payload: dict) -> list[dict]:
        ...

Execution is a short-lived subprocess (JSON in/out) so a bad handler cannot
take down the API process. Results always pass through the normal paint
``validate_ops`` gate (preferred_tools / contract).
"""
from __future__ import annotations

import json
import logging
import subprocess
import sys
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_BOOTSTRAP = r'''
import importlib.util
import json
import sys

def main() -> int:
    raw = sys.stdin.read()
    try:
        msg = json.loads(raw or "{}")
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"bad_input:{exc}"}))
        return 2
    path = str(msg.get("handler") or "").strip()
    ctx = msg.get("ctx") if isinstance(msg.get("ctx"), dict) else {}
    payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
    if not path:
        print(json.dumps({"ok": False, "error": "handler_missing"}))
        return 2
    try:
        spec = importlib.util.spec_from_file_location("skill_ops_handler", path)
        if spec is None or spec.loader is None:
            print(json.dumps({"ok": False, "error": "handler_spec"}))
            return 2
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        run = getattr(mod, "run", None)
        if not callable(run):
            print(json.dumps({"ok": False, "error": "run_missing"}))
            return 2
        out = run(ctx, payload)
        if not isinstance(out, list):
            print(json.dumps({"ok": False, "error": "ops_not_list"}))
            return 2
        ops = [x for x in out if isinstance(x, dict)]
        print(json.dumps({"ok": True, "ops": ops}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"handler_exc:{type(exc).__name__}:{exc}"}))
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
'''


def _runner_enabled() -> bool:
    from app.core.config import settings

    return bool(getattr(settings, "design_skill_ops_runner", False))


def _runner_timeout_sec() -> float:
    from app.core.config import settings

    raw = getattr(settings, "design_skill_ops_runner_timeout_sec", 8.0)
    try:
        return max(1.0, float(raw or 8.0))
    except (TypeError, ValueError):
        return 8.0


def resolve_skill_handler_path(skill_key: str) -> Path | None:
    """Locate ``handler.py`` for a loaded skill under known pack roots."""
    from .pack_io import _file_skills_dirs

    key = str(skill_key or "").strip().lower()
    if not key:
        return None
    # Bare key or last segment of namespace.qualified
    local = key.split(".")[-1] if "." in key else key
    for root in _file_skills_dirs():
        for folder in (local, key):
            pack = root / folder
            handler = pack / "handler.py"
            if handler.is_file():
                try:
                    # Stay inside the pack root.
                    handler.resolve().relative_to(pack.resolve())
                except Exception:
                    continue
                return handler
    return None


def find_handler_for_skills(skill_keys: list[str] | tuple[str, ...] | None) -> tuple[str, Path] | None:
    """Return ``(skill_key, handler_path)`` for the first loaded skill with a handler."""
    for raw in skill_keys or []:
        key = str(raw or "").strip()
        if not key:
            continue
        path = resolve_skill_handler_path(key)
        if path is not None:
            return key, path
    return None


def run_skill_handler_ops(
    *,
    handler_path: Path,
    skill_key: str,
    ctx: dict[str, Any],
    payload: dict[str, Any],
    timeout_sec: float | None = None,
) -> tuple[list[dict[str, Any]] | None, str | None]:
    """Subprocess-run ``handler.run`` → ``(ops, error)``.

    On success ``error`` is None. Empty ops list is a valid success (caller may
    fall through to LLM paint).
    """
    if not _runner_enabled():
        return None, "runner_disabled"
    path = Path(handler_path)
    if not path.is_file():
        return None, "handler_missing"
    timeout = _runner_timeout_sec() if timeout_sec is None else max(1.0, float(timeout_sec))
    msg = {
        "handler": str(path.resolve()),
        "ctx": {
            "skill_key": skill_key,
            **(ctx if isinstance(ctx, dict) else {}),
        },
        "payload": payload if isinstance(payload, dict) else {},
    }
    try:
        proc = subprocess.run(
            [sys.executable, "-c", _BOOTSTRAP],
            input=json.dumps(msg, ensure_ascii=False).encode("utf-8"),
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        logger.warning("skill ops runner timeout skill=%s path=%s", skill_key, path)
        return None, "timeout"
    except Exception as exc:
        logger.warning("skill ops runner spawn failed skill=%s: %s", skill_key, exc)
        return None, f"spawn:{type(exc).__name__}"

    raw_out = (proc.stdout or b"").decode("utf-8", errors="replace").strip()
    if not raw_out:
        err = (proc.stderr or b"").decode("utf-8", errors="replace").strip()[:200]
        return None, f"empty_stdout:{err or proc.returncode}"
    try:
        data = json.loads(raw_out.splitlines()[-1])
    except Exception:
        return None, "bad_stdout_json"
    if not isinstance(data, dict) or not data.get("ok"):
        return None, str((data or {}).get("error") or "handler_failed")
    ops = data.get("ops")
    if not isinstance(ops, list):
        return None, "ops_not_list"
    return [x for x in ops if isinstance(x, dict)], None


def try_skill_ops_for_paint(
    *,
    skill_keys: list[str] | None,
    prompt: str,
    scene_key: str,
    scene_nodes: list[Any] | None = None,
    scene_frames: list[Any] | None = None,
    design_brief: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]] | None, str | None, str | None]:
    """Paint short-circuit helper.

    Returns ``(ops, skill_key, error)``.
    - ``ops is not None`` → runner produced a list (may be empty)
    - ``ops is None`` and ``error`` → skip / fail; caller falls through to LLM
    - ``ops is None`` and ``error is None`` → runner off or no handler
    """
    if not _runner_enabled():
        return None, None, None
    hit = find_handler_for_skills(skill_keys)
    if not hit:
        return None, None, None
    skill_key, handler = hit
    ctx = {
        "skill_key": skill_key,
        "prompt": str(prompt or "")[:4000],
        "scene": str(scene_key or ""),
        "scene_nodes": list(scene_nodes or [])[:80],
        "scene_frames": list(scene_frames or [])[:40],
        "design_brief": design_brief if isinstance(design_brief, dict) else {},
    }
    payload = {
        "prompt": str(prompt or "")[:4000],
        "scene": str(scene_key or ""),
    }
    ops, err = run_skill_handler_ops(
        handler_path=handler,
        skill_key=skill_key,
        ctx=ctx,
        payload=payload,
    )
    if err:
        logger.info("skill ops runner skip skill=%s err=%s", skill_key, err)
        return None, skill_key, err
    return ops or [], skill_key, None
