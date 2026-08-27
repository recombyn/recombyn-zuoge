"""Optional skill ``hooks.py`` — register zuoge Harness pipeline hooks."""
from __future__ import annotations

import importlib.util
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_LOADED_HOOK_SKILLS: set[str] = set()


def resolve_skill_hooks_path(skill_key: str) -> Path | None:
    from app.services.design.prompts.skill_store.pack_io import _file_skills_dirs

    key = str(skill_key or "").strip().lower()
    if not key:
        return None
    local = key.split(".")[-1] if "." in key else key
    for root in _file_skills_dirs():
        for folder in (local, key):
            hooks = root / folder / "hooks.py"
            if not hooks.is_file():
                continue
            try:
                hooks.resolve().relative_to((root / folder).resolve())
            except ValueError:
                continue
            return hooks
    return None


def _load_register_fn(path: Path, skill_key: str) -> Any | None:
    spec = importlib.util.spec_from_file_location(f"skill_hooks_{skill_key}", path)
    if spec is None or spec.loader is None:
        return None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    fn = getattr(mod, "register_pipeline", None)
    return fn if callable(fn) else None


def register_skill_pipeline_hooks(registry: Any, skill_keys: list[str]) -> None:
    """Import ``hooks.py`` once per skill and call ``register_pipeline(registry)``."""
    for raw in skill_keys:
        key = str(raw or "").strip().lower()
        if not key or key in _LOADED_HOOK_SKILLS:
            continue
        path = resolve_skill_hooks_path(key)
        if path is None:
            continue
        try:
            fn = _load_register_fn(path, key)
            if fn is None:
                continue
            fn(registry)
            _LOADED_HOOK_SKILLS.add(key)
            logger.debug("skill hooks registered skill=%s path=%s", key, path)
        except Exception:
            logger.debug("skill hooks load failed skill=%s", key, exc_info=True)
