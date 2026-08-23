from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parents[3]


class VisionSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ILP_", extra="ignore")

    api_v1_str: str = "/api/v1"
    workspace: Path = _REPO_ROOT / "workspace"
    config_yaml: Path = _REPO_ROOT / "configs" / "image_layer_default.yaml"
    redis_url: str = "redis://127.0.0.1:6379/0"
    use_celery: bool = False
    max_job_workers: int = 2
    job_ttl_seconds: int = 7 * 86400
    ocr_lang: str = "ch"
    ocr_text_min_confidence: float = 0.72


settings = VisionSettings()
