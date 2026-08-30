"""SQLAlchemy / SQLModel engine and session factory."""

from __future__ import annotations

from sqlmodel import Session, SQLModel, create_engine

from app.core.config import _API_ROOT, settings


def sqlalchemy_database_uri() -> str:
    """
    Convert product DATABASE_URL into a SQLAlchemy URL.

    - mysql:// → mysql+pymysql://
    - postgres:// → postgresql+psycopg://
    """
    raw = (settings.database_url or "").strip()
    if not raw:
        raise RuntimeError(
            "DATABASE_URL is required (mysql://… or postgresql://…). "
            "Set DATABASE_URL in apps/api/.env."
        )
    lower = raw.lower()
    if lower.startswith("mysql+pymysql://"):
        return raw
    if lower.startswith("mysql://"):
        return "mysql+pymysql://" + raw[len("mysql://") :]
    if lower.startswith("postgresql+psycopg://") or lower.startswith("postgresql+psycopg2://"):
        return raw
    if lower.startswith("postgres://"):
        return "postgresql+psycopg://" + raw[len("postgres://") :]
    if lower.startswith("postgresql://"):
        return "postgresql+psycopg://" + raw[len("postgresql://") :]
    raise RuntimeError(f"Unsupported DATABASE_URL for SQLModel: {raw[:48]}…")


_uri = sqlalchemy_database_uri() if (settings.database_url or "").strip() else ""
_connect_args: dict = {}
_engine_kwargs: dict = {"echo": False, "pool_pre_ping": True}

# Lazy-safe: config may load before .env is applied in some test bootstraps.
# reset_engine() rebuilds after DATABASE_URL is set.
if _uri:
    engine = create_engine(_uri, connect_args=_connect_args, **_engine_kwargs)
else:
    # Placeholder so imports succeed; must call reset_engine() after setting URL.
    engine = create_engine(
        "mysql+pymysql://recombyn:recombyn@127.0.0.1:3306/recombyn",
        connect_args=_connect_args,
        **_engine_kwargs,
    )


def _invalidate_bootstrap_flags() -> None:
    """DDL/catalog ready flags are process-global — clear when the engine URI changes."""
    try:
        import app.services.db as db_mod

        db_mod._SCHEMA_READY = False
    except Exception:
        pass
    try:
        import app.services.llm.catalog_store as llm_catalog_mod

        llm_catalog_mod._CATALOG_SEEDED = False
    except Exception:
        pass
    try:
        import app.services.llm.usage_log as usage_mod

        usage_mod._TABLE_READY = False
    except Exception:
        pass
    try:
        import app.services.design.readpath.catalog as catalog_mod

        catalog_mod._CATALOG_READY = False
    except Exception:
        pass
    try:
        import app.services.design.prompts.skill_store as skill_mod

        if hasattr(skill_mod, "reset_skills_ready_for_tests"):
            skill_mod.reset_skills_ready_for_tests()
        else:
            skill_mod._SKILLS_READY = False
    except Exception:
        pass


def reset_engine() -> None:
    """Dispose and rebuild ``engine`` after tests change DATABASE_URL."""
    global engine, _uri, _connect_args, _engine_kwargs
    try:
        engine.dispose()
    except Exception:
        pass
    _uri = sqlalchemy_database_uri()
    _connect_args = {}
    _engine_kwargs = {"echo": False, "pool_pre_ping": True}
    engine = create_engine(_uri, connect_args=_connect_args, **_engine_kwargs)
    _invalidate_bootstrap_flags()


def init_db() -> None:
    """Import models so SQLModel metadata is registered for Alembic / Session."""
    from app import models as _models  # noqa: F401

    _ = SQLModel.metadata


def run_migrations() -> None:
    """Apply Alembic migrations to ``head`` (idempotent; safe under multi-process)."""
    from alembic import command
    from alembic.config import Config
    from sqlalchemy.exc import IntegrityError, OperationalError

    init_db()
    uri = sqlalchemy_database_uri()
    cfg = Config(str(_API_ROOT / "alembic.ini"))
    # ConfigParser treats ``%`` as interpolation — escape DB URLs with %XX encoding.
    cfg.set_main_option("sqlalchemy.url", uri.replace("%", "%%"))
    # script_location in alembic.ini is relative to apps/api cwd when running CLI;
    # pin absolute path for in-process calls from arbitrary working directories.
    cfg.set_main_option("script_location", str(_API_ROOT / "app" / "alembic"))

    try:
        command.upgrade(cfg, "head")
    except (IntegrityError, OperationalError) as err:
        # Concurrent stamp under xdist / multi-worker boot.
        msg = str(err).lower()
        if "alembic_version" in msg and (
            "unique" in msg or "duplicate" in msg
        ):
            from alembic.runtime.migration import MigrationContext

            try:
                with engine.connect() as conn:
                    if MigrationContext.configure(conn).get_current_revision():
                        return
            except Exception:
                pass
        raise


def get_session() -> Session:
    """Open a short-lived Session (callers should ``with`` / close)."""
    return Session(engine)
