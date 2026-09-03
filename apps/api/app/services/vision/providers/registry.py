"""Resolve vision provider by kind (explicit env, no silent fallback)."""

from __future__ import annotations

from app.core.config import settings
from app.services.vision.providers import seedream as sd
from app.services.vision.providers import wavespeed as ws

_EDIT_ELEMENTS_PROVIDERS = frozenset({"seedream", "wavespeed"})


def wavespeed_enabled() -> bool:
    return ws.wavespeed_enabled()


def wavespeed_supports() -> list[str]:
    return ws.wavespeed_supports()


def seedream_enabled() -> bool:
    return sd.seedream_enabled()


def seedream_supports() -> list[str]:
    return sd.seedream_supports()


def resolve_multi_angle_provider() -> str:
    name = str(settings.vision_multiangle_provider or "wavespeed").strip().lower()
    if name != "wavespeed":
        raise RuntimeError(
            f"Unsupported VISION_MULTIANGLE_PROVIDER={name!r}; only wavespeed is wired"
        )
    if not ws.wavespeed_enabled():
        raise RuntimeError(
            "此功能需要配置 WaveSpeedAI（设置 WAVESPEED_API_KEY，"
            "见 https://wavespeed.ai/）"
        )
    return "wavespeed"


def resolve_edit_elements_provider() -> str:
    name = str(settings.vision_edit_elements_provider or "seedream").strip().lower()
    if name not in _EDIT_ELEMENTS_PROVIDERS:
        raise RuntimeError(
            f"Unsupported VISION_EDIT_ELEMENTS_PROVIDER={name!r}; "
            f"use one of: {', '.join(sorted(_EDIT_ELEMENTS_PROVIDERS))}"
        )
    if name == "seedream":
        if not sd.seedream_enabled():
            raise RuntimeError(
                "此功能需要配置豆包方舟（设置 DOUBAO_API_KEY，"
                "见 https://console.volcengine.com/ark）"
            )
        return "seedream"
    if not ws.wavespeed_enabled():
        raise RuntimeError(
            "此功能需要配置 WaveSpeedAI（设置 WAVESPEED_API_KEY，"
            "见 https://wavespeed.ai/）"
        )
    return "wavespeed"
