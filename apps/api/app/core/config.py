from __future__ import annotations

import os
import sys
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def resolve_api_root() -> Path:
    """apps/api root — source tree, RECOMBYN_API_ROOT, or PyInstaller bundle."""
    raw = (os.environ.get("RECOMBYN_API_ROOT") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            return Path(meipass)
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


_API_ROOT = resolve_api_root()

_ENV_FILE = _API_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE) if _ENV_FILE.is_file() else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # App metadata
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "Recombyn API"
    # Env may use either DATABASE_URL or database_url (pydantic-settings is case-insensitive).
    # Prefer documenting DATABASE_URL in deploy; attribute remains database_url below.

    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        # Tauri 2 WebView origins (desktop flavors calling absolute API base).
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
    ]
    # Allow any localhost / tauri.dev origin in addition to the explicit list.
    cors_origin_regex: str | None = (
        r"^https?://(localhost|127\.0\.0\.1|tauri\.localhost)(:\d+)?$|^tauri://localhost$"
    )
    upload_dir: str = "storage/uploads"
    result_dir: str = "storage/results"
    # 0 = no per-file size cap (chunked upload handles large bodies).
    max_upload_mb: int = 0
    max_video_upload_mb: int = 0
    upload_chunk_size_mb: int = 8
    # Reject uploads whose magic bytes disagree with claimed image/video/audio type.
    upload_require_magic_match: bool = True
    # Optional external scanner (e.g. clamscan); off by default.
    upload_av_hook_enabled: bool = False
    upload_av_command: str = ""

    log_json: bool = False
    otel_enabled: bool = False
    otel_service_name: str = "recombyn-api"

    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"
    import_dpi: int = 200
    job_ttl_seconds: int = 86400

    use_vision: bool = True
    ocr_lang: str = "ch"
    scene_target_width: int = 794
    palette_k: int = 5

    s3_enabled: bool = False
    s3_endpoint_url: str | None = None
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_bucket: str = "recombyn"
    s3_region: str = "ap-guangzhou"
    s3_public_base_url: str | None = None
    s3_addressing_style: str = "virtual"
    s3_acl_public_read: bool = True

    # Empty → SQLite at sqlite_db_path.
    database_url: str = ""
    database_readonly_url: str = ""
    sqlite_db_path: str = "storage/recombyn.db"
    sqlite_busy_timeout_ms: int = 30000
    sqlite_wal: bool = True
    db_backup_enabled: bool = True
    db_backup_interval_hours: float = 24.0
    db_backup_dir: str = "storage/backups"
    db_backup_keep: int = 14
    langgraph_checkpoint_url: str = ""
    langgraph_checkpoint_sqlite_path: str = "storage/langgraph_checkpoints.db"
    design_graph_checkpoint: bool = True
    design_graph_retry_attempts: int = 3
    design_graph_node_timeout_sec: float = 180.0
    design_graph_paint_timeout_sec: float = 300.0
    design_paint_attempt_timeout_sec: float = 90.0
    design_image_hydrate_timeout_sec: float = 90.0
    design_image_hydrate_async: bool = True
    # Worker mode is opt-in until command subscription is enabled in production.
    design_agent_worker_enabled: bool = False
    design_agent_worker_requeue_sec: float = 60.0
    design_agent_outbox_retention_days: int = 7
    design_image_hydrate_queue_stall_sec: float = 5.0
    design_review_llm_timeout_sec: float = 100.0
    design_exec_trace: bool = False
    # Cloud intelligence + image hydrate + review retry often exceeds 10 minutes.
    design_graph_run_timeout_sec: float = 1200.0
    design_run_timeout_resumable: bool = True
    design_run_error_resumable: bool = True
    design_run_checkpoint_ttl_hours: float = 72.0
    design_run_checkpoint_sweep_interval_hours: float = 6.0
    design_graph_require_durable_checkpoint: bool = True
    design_critique_enabled: bool = True
    design_review_agent_enabled: bool = True
    design_review_mode: str = "auto"
    design_run_lease_ttl_sec: float = 90.0
    design_scene_wait_poll_ms: float = 150.0
    langgraph_store_url: str = ""
    langgraph_store_sqlite_path: str = "storage/langgraph_store.db"
    byok_aes_key: str = ""
    rate_limit_enabled: bool = True
    rate_limit_window_sec: int = 60
    rate_limit_auth_per_window: int = 180
    rate_limit_design_per_window: int = 40
    rate_limit_chat_per_window: int = 60
    rate_limit_upload_per_window: int = 40
    rate_limit_projects_per_window: int = 240
    rate_limit_default_per_window: int = 180
    agent_summarize_enabled: bool = True
    agent_summarize_trigger_tokens: int = 4000
    agent_summarize_keep_messages: int = 20
    agent_summarize_model: str = ""

    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_base_url: str = "https://cloud.langfuse.com"
    langfuse_tracing: bool = False
    langfuse_project_id: str = ""

    design_skills_hot_reload: bool = True
    design_skills_hot_reload_interval_sec: float = 2.0
    design_skills_plugin_dirs: str = ""
    design_skill_ops_runner: bool = False
    design_skill_ops_runner_timeout_sec: float = 8.0
    design_plugin_hmac_secret: str = ""
    design_plugin_disk_install: bool = False

    agent_profile_id: str = "design.canvas"

    # Design Intelligence client (ADR 0017). local = BasicLocal; remote = HTTP provider.
    intelligence_provider: str = Field(
        default="local",
        validation_alias="RECOMBYN_INTELLIGENCE_MODE",
    )
    intelligence_remote_url: str = Field(
        default="",
        validation_alias="RECOMBYN_INTELLIGENCE_URL",
    )
    intelligence_remote_api_key: str = Field(
        default="",
        validation_alias="RECOMBYN_INTELLIGENCE_API_KEY",
    )
    intelligence_remote_timeout_sec: float = Field(
        default=30.0,
        validation_alias="RECOMBYN_INTELLIGENCE_TIMEOUT_SEC",
    )
    intelligence_circuit_sec: float = Field(
        default=30.0,
        validation_alias="RECOMBYN_INTELLIGENCE_CIRCUIT_SEC",
    )

    # Closed-source Image Layer Pipeline (depth/matting/inpaint). Empty = disabled.
    image_layer_pipeline_url: str = Field(
        default="",
        validation_alias="IMAGE_LAYER_PIPELINE_URL",
    )
    image_layer_pipeline_api_key: str = Field(
        default="",
        validation_alias="IMAGE_LAYER_PIPELINE_API_KEY",
    )
    # legacy = SAM/rembg path (default); ilp = always ILP; auto = ILP with legacy fallback.
    image_layer_pipeline_mode: str = Field(
        default="legacy",
        validation_alias="IMAGE_LAYER_PIPELINE_MODE",
    )
    image_layer_pipeline_timeout_sec: float = Field(
        default=300.0,
        validation_alias="IMAGE_LAYER_PIPELINE_TIMEOUT_SEC",
    )
    image_layer_pipeline_poll_sec: float = Field(
        default=1.0,
        validation_alias="IMAGE_LAYER_PIPELINE_POLL_SEC",
    )

    expand_table_cells: bool = True
    sam_checkpoint: str | None = None
    sam_model_type: str = "vit_t"
    sam_min_area_ratio: float = 0.02
    sam_max_regions: int = 8
    lama_use_sam_mask: bool = True

    llm_provider: str = "deepseek"
    llm_api_key: str = ""
    llm_base_url: str = ""
    llm_default_model: str = "deepseek-reasoner"
    image_default_model: str = ""
    doubao_api_key: str = ""
    deepseek_api_key: str = ""
    openrouter_api_key: str = ""
    qwen_api_key: str = ""
    moonshot_api_key: str = ""
    openrouter_http_referer: str = ""
    openrouter_app_title: str = "recombyn"
    openrouter_block_countries: str = "CN"
    geolite2_country_db: str = ""
    client_country_override: str = ""
    doubao_seed_model: str = ""
    doubao_pro_model: str = ""

    google_client_id: str = ""
    google_client_secret: str = ""
    google_oauth_timeout_sec: float = 30.0
    google_oauth_http_proxy: str = ""

    super_admin_test_code: str = ""
    auth_console_login_code: bool = False
    desktop_local_auto_login: bool = False
    wallet_billing_enabled: bool = False

    card_key_salt: str = ""
    card_key_ops_password: str = ""
    xianyu_shop_url: str = ""
    author_contact: str = ""
    xianyu_qr_url: str = ""
    wechat_qr_url: str = ""

    tencent_secret_id: str = ""
    tencent_secret_key: str = ""
    ses_region: str = "ap-hongkong"
    ses_from_email: str = ""
    ses_from_name: str = "recombyn"
    ses_template_id: int = 0
    ses_activate_base_url: str = "https://recombyn.com/activate"
    public_app_base_url: str = ""

    # MCP canvas server — external clients control project documents via tool_ops.
    mcp_canvas_enabled: bool = False

settings = Settings()


def is_desktop_local() -> bool:
    return bool(getattr(settings, "desktop_local_auto_login", False))


def api_seeds_dir() -> Path:
    return _API_ROOT / "seeds"


def resolve_seed_file(*parts: str) -> Path:
    return api_seeds_dir().joinpath(*parts)


def resolve_seed_dir(*parts: str) -> Path:
    """Resolve a seed directory under apps/api/seeds/."""
    return api_seeds_dir().joinpath(*parts)
