"""SQLAlchemy / SQLModel engine and session factory."""

from __future__ import annotations

from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

from app.core.config import _API_ROOT, settings


def sqlalchemy_database_uri() -> str:
    """
    Convert product DATABASE_URL into a SQLAlchemy URL.

    - empty → sqlite file under apps/api/storage
    - mysql:// → mysql+pymysql://
    - postgres:// → postgresql+psycopg://
    """
    raw = (settings.database_url or "").strip()
    if not raw:
        path = Path(settings.sqlite_db_path)
        if not path.is_absolute():
            path = _API_ROOT / path
        path.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{path.as_posix()}"
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
    if lower.startswith("sqlite:"):
        # Normalize relative sqlite paths to apps/api so engine matches connect().
        rest = raw.split(":", 1)[1].lstrip("/")
        if rest.startswith("/") and len(rest) > 2 and rest[2] == ":":
            rest = rest[1:]
        rest = rest.split("?", 1)[0]
        path = Path(rest)
        if not path.is_absolute():
            path = (_API_ROOT / path).resolve()
        else:
            path = path.resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{path.as_posix()}"
    raise RuntimeError(f"Unsupported DATABASE_URL for SQLModel: {raw[:48]}…")


# Pool: SQLite needs check_same_thread=False for FastAPI; MySQL uses default pool.
_uri = sqlalchemy_database_uri()
_connect_args: dict = {}
_engine_kwargs: dict = {"echo": False}
if _uri.startswith("sqlite"):
    _connect_args["check_same_thread"] = False
else:
    _engine_kwargs["pool_pre_ping"] = True

engine = create_engine(_uri, connect_args=_connect_args, **_engine_kwargs)


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
    """Dispose and rebuild ``engine`` after tests change SQLITE_DB_PATH / DATABASE_URL."""
    global engine, _uri, _connect_args, _engine_kwargs
    try:
        engine.dispose()
    except Exception:
        pass
    _uri = sqlalchemy_database_uri()
    _connect_args = {}
    _engine_kwargs = {"echo": False}
    if _uri.startswith("sqlite"):
        _connect_args["check_same_thread"] = False
    else:
        _engine_kwargs["pool_pre_ping"] = True
    engine = create_engine(_uri, connect_args=_connect_args, **_engine_kwargs)
    _invalidate_bootstrap_flags()


def init_db() -> None:
    """Import models so SQLModel metadata is registered for Alembic / Session."""
    from app import models as _models  # noqa: F401

    _ = SQLModel.metadata


def run_migrations() -> None:
    """Apply Alembic migrations to ``head`` (idempotent; safe under multi-process)."""
    import os
    import time
    from contextlib import contextmanager

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

    @contextmanager
    def _sqlite_lock():
        if not uri.startswith("sqlite"):
            yield
            return
        raw = uri.split("sqlite:///", 1)[-1].split("?", 1)[0]
        db_path = Path(raw)
        lock_path = db_path.with_name(db_path.name + ".alembic.lock")
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        fh = open(lock_path, "a+b")
        try:
            if os.name == "nt":
                import msvcrt

                while True:
                    try:
                        msvcrt.locking(fh.fileno(), msvcrt.LK_LOCK, 1)
                        break
                    except OSError:
                        time.sleep(0.05)
            else:
                import fcntl

                fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
            yield
        finally:
            try:
                if os.name == "nt":
                    import msvcrt

                    fh.seek(0)
                    msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
            except Exception:
                pass
            fh.close()

    with _sqlite_lock():
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
