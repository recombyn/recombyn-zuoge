"""Shared rule / text helpers for the design agent."""
from __future__ import annotations

import logging
import sys
import time
from typing import Any

_log = logging.getLogger(__name__)


def _as_text(value: Any, default: str = "") -> str:
    """Coerce rule / request values to str before .strip() — DB/JSON may yield ints."""
    if value is None:
        return default
    if isinstance(value, str):
        return value
    return str(value)


def _rule_text(rules: dict[str, Any] | None, key: str, default: str = "") -> str:
    rules = rules or {}
    if key not in rules or rules.get(key) is None:
        return default
    return _as_text(rules.get(key), default)


def render_prompt_template(template: str, **variables: Any) -> str:
    """Fill Admin / pack strings via LangChain ``PromptTemplate``.

    Always goes through LC (including zero-variable bodies). Literal JSON
    braces are escaped; only ``{name}`` keys present in ``variables`` are filled.
    """
    text = str(template or "")
    if not text:
        return ""
    keys = [k for k in variables if f"{{{k}}}" in text] if variables else []
    try:
        from langchain_core.prompts import PromptTemplate

        escaped = text
        for k in keys:
            escaped = escaped.replace(f"{{{k}}}", f"__LC_VAR_{k}__")
        escaped = escaped.replace("{", "{{").replace("}", "}}")
        for k in keys:
            escaped = escaped.replace(f"__LC_VAR_{k}__", f"{{{k}}}")
        return PromptTemplate(template=escaped, input_variables=list(keys)).format(
            **{k: variables[k] for k in keys}
        )
    except Exception:
        if not keys:
            return text
        out = text
        for k in keys:
            out = out.replace(f"{{{k}}}", str(variables[k]))
        return out


def _safe_print(msg: str) -> None:
    """Windows consoles often reject emoji (UnicodeEncodeError or OSError 22)."""
    try:
        print(msg, flush=True)
    except (UnicodeEncodeError, OSError):
        enc = getattr(sys.stdout, "encoding", None) or "utf-8"
        try:
            buf = getattr(sys.stdout, "buffer", None)
            if buf is not None:
                buf.write((msg + "\n").encode(enc, errors="replace"))
                buf.flush()
            else:
                print(msg.encode("ascii", errors="replace").decode("ascii"), flush=True)
        except Exception:
            pass


def _exec_trace_verbose() -> bool:
    try:
        from app.core.config import settings

        return bool(getattr(settings, "design_exec_trace", False))
    except Exception:
        return False


def exec_trace(
    t0: float | None,
    phase: str,
    *,
    mode: str = "run",
    **extra: Any,
) -> None:
    """Stage timer for classifying stalls. Debug by default; stdout only when enabled."""
    if t0 is None:
        head = f"[exec] mode={mode} phase={phase}"
    else:
        head = f"[exec] +{time.time() - t0:6.2f}s mode={mode} phase={phase}"
    bits = " ".join(f"{k}={v!r}" for k, v in extra.items() if v is not None)
    msg = head + (f"  {bits}" if bits else "")
    if _exec_trace_verbose():
        _log.info(msg)
        _safe_print(msg)
    else:
        _log.debug(msg)


def _stage(t0: float, label: str, **extra: Any) -> None:
    """Stage timer for diagnosing design-run stalls."""
    exec_trace(t0, label, mode="run", **extra)


def _rule_flag_on(rules: dict[str, str], key: str, default: str = "1") -> bool:
    return str(rules.get(key, default)).strip().lower() not in ("0", "false", "off", "no")
