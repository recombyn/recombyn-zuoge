"""Mockup HTTP service settings."""

from __future__ import annotations

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class MockupSettings(BaseSettings):
  model_config = SettingsConfigDict(env_prefix="MOCKUP_", extra="ignore")

  api_v1_str: str = "/api/v1"
  templates_dir: Path = Path(
    os.environ.get("MOCKUP_TEMPLATES_DIR", "/data/mockup/templates")
  )
  use_celery: bool = os.environ.get("MOCKUP_USE_CELERY", "false").lower() in (
    "1",
    "true",
    "yes",
  )
  redis_url: str = os.environ.get("MOCKUP_REDIS_URL", "redis://127.0.0.1:6379/1")
  max_job_workers: int = int(os.environ.get("MOCKUP_MAX_WORKERS", "4"))


settings = MockupSettings()
