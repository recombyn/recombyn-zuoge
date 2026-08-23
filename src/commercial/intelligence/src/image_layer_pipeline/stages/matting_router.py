"""Matting model routing — one high-precision general path (+ benchmark presets)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

BUILTIN_MODELS = frozenset(
    {
        "birefnet-general",
        "birefnet-general-lite",
        "birefnet-portrait",
        "birefnet-dis",
        "birefnet-hrsod",
        "birefnet-cod",
        "birefnet-massive",
        "isnet-general-use",
        "u2net",
        "u2net_human_seg",
    }
)

SCENE_ALIASES: dict[str, str] = {
    "portrait": "general",
    "hair": "general",
    "person": "general",
    "human": "general",
    "transparent": "general",
    "glass": "general",
    "product_glass": "general",
    "trans": "general",
    "general": "general",
    "product": "general",
    "auto": "general",
}

BENCHMARK_PRESETS: frozenset[str] = frozenset({"portrait", "transparent"})


@dataclass(frozen=True)
class MattingRoute:
    scene: str
    model: str
    decontaminate: float
    custom_onnx: str | None = None


def _env_float(key: str, default: float) -> float:
    raw = str(os.environ.get(key, "") or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_model(key: str, default: str) -> str:
    return str(os.environ.get(key, "") or "").strip() or default


def _clamp_decontaminate(value: float) -> float:
    return max(0.0, min(1.0, value))


def _scene_defaults() -> dict[str, dict[str, Any]]:
    return {
        "general": {
            "model": _env_model("ILP_MATTING_MODEL_GENERAL", "birefnet-general"),
            "decontaminate": _env_float("ILP_MATTING_DECONTAMINATE_GENERAL", 0.65),
            "onnx_env": "ILP_MATTING_ONNX",
        },
        "portrait": {
            "model": _env_model("ILP_MATTING_MODEL_PORTRAIT", "birefnet-portrait"),
            "decontaminate": _env_float("ILP_MATTING_DECONTAMINATE_PORTRAIT", 0.72),
            "onnx_env": "ILP_MATTING_PORTRAIT_ONNX",
        },
        "transparent": {
            "model": _env_model("ILP_MATTING_MODEL_TRANSPARENT", "birefnet-general"),
            "decontaminate": _env_float("ILP_MATTING_DECONTAMINATE_TRANSPARENT", 0.55),
            "onnx_env": "ILP_MATTING_TRANSPARENT_ONNX",
        },
    }


def normalize_scene(raw: str | None) -> str:
    key = str(raw or "auto").strip().lower() or "auto"
    if key in BENCHMARK_PRESETS:
        return key
    return SCENE_ALIASES.get(key, "general")


def _resolve_onnx_path(
    *,
    preset_env: str,
    explicit: str,
    use_precision_onnx: bool,
    production_fallback: bool,
) -> str:
    if explicit:
        path = Path(explicit)
        return str(path) if path.is_file() else ""
    if not use_precision_onnx:
        return ""

    from image_layer_pipeline.stages.matting_model_paths import (
        resolve_preset_onnx,
        resolve_production_onnx,
    )

    if preset_env:
        preset = resolve_preset_onnx(preset_env)
        if preset is not None:
            return str(preset)

    if not production_fallback:
        return ""

    found = resolve_production_onnx()
    return str(found) if found is not None else ""


def _route_scene_label(norm_scene: str) -> str:
    if norm_scene in BENCHMARK_PRESETS:
        return norm_scene
    return "general"


def _make_route(
    *,
    scene: str,
    model: str,
    decontaminate: float,
    custom_onnx: str | None,
) -> MattingRoute:
    onnx = custom_onnx if model == "ben_custom" else None
    return MattingRoute(
        scene=scene,
        model=model,
        decontaminate=_clamp_decontaminate(decontaminate),
        custom_onnx=onnx,
    )


def resolve_matting_route(
    *,
    scene: str | None = None,
    model: str | None = None,
    decontaminate: float | None = None,
    custom_onnx: str | None = None,
    use_precision_onnx: bool = True,
) -> MattingRoute:
    """One general production path; portrait/transparent presets are benchmark-only."""
    defaults = _scene_defaults()
    norm_scene = normalize_scene(scene)
    preset = defaults.get(norm_scene) or defaults["general"]
    preset_env = str(preset.get("onnx_env") or "")
    production_fallback = norm_scene not in BENCHMARK_PRESETS

    if model and str(model).strip():
        explicit_model = str(model).strip()
        strength = float(decontaminate) if decontaminate is not None else float(
            defaults["general"]["decontaminate"]
        )
        onnx_path = _resolve_onnx_path(
            preset_env=preset_env,
            explicit=str(custom_onnx or "").strip(),
            use_precision_onnx=use_precision_onnx,
            production_fallback=production_fallback,
        )
        if explicit_model == "ben_custom":
            if not onnx_path:
                onnx_path = _resolve_onnx_path(
                    preset_env=preset_env,
                    explicit="",
                    use_precision_onnx=True,
                    production_fallback=True,
                )
            if onnx_path:
                return _make_route(
                    scene="general",
                    model="ben_custom",
                    decontaminate=strength,
                    custom_onnx=onnx_path,
                )
        return _make_route(
            scene=_route_scene_label(norm_scene),
            model=explicit_model,
            decontaminate=strength,
            custom_onnx=None,
        )

    onnx_path = _resolve_onnx_path(
        preset_env=preset_env,
        explicit=str(custom_onnx or "").strip(),
        use_precision_onnx=use_precision_onnx,
        production_fallback=production_fallback,
    )
    chosen_model = str(preset["model"])
    if onnx_path:
        chosen_model = "ben_custom"

    strength = float(decontaminate) if decontaminate is not None else float(preset["decontaminate"])
    return _make_route(
        scene=_route_scene_label(norm_scene),
        model=chosen_model,
        decontaminate=strength,
        custom_onnx=onnx_path or None,
    )


def route_engine_label(route: MattingRoute) -> str:
    if route.custom_onnx:
        return "ilp:hr-matting+subpixel"
    return f"ilp:{route.model}+subpixel"
