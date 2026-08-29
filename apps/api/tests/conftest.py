"""Shared pytest fixtures for API tests (MySQL-only)."""

from __future__ import annotations

import os
from urllib.parse import unquote, urlparse

import pytest

_DEFAULT_TEST_URL = "mysql://recombyn:recombyn@127.0.0.1:3306/recombyn_test"


def _pick_base_mysql_url() -> str:
    for key in ("TEST_DATABASE_URL", "DATABASE_URL"):
        raw = (os.environ.get(key) or "").strip()
        if raw.lower().startswith("mysql"):
            return raw
    return _DEFAULT_TEST_URL


def _parse_mysql(url: str):
    return urlparse(url.replace("mysql+pymysql://", "mysql://", 1))


def _db_name_from_url(url: str) -> str:
    name = (_parse_mysql(url).path or "/").lstrip("/") or "recombyn_test"
    # Never point tests at the live app DB name.
    if not name.startswith("recombyn_test"):
        return "recombyn_test"
    return name


def _replace_db_name(url: str, db_name: str) -> str:
    parsed = _parse_mysql(url)
    user = unquote(parsed.username or "recombyn")
    password = unquote(parsed.password or "")
    host = parsed.hostname or "127.0.0.1"
    port = int(parsed.port or 3306)
    auth = f"{user}:{password}@" if password else f"{user}@"
    return f"mysql://{auth}{host}:{port}/{db_name}"


def _worker_db_name(base_url: str) -> str:
    base = _db_name_from_url(base_url)
    worker = (os.environ.get("PYTEST_XDIST_WORKER") or "").strip()
    if worker:
        return f"{base}_{worker}"
    return base


_BASE_MYSQL_URL = _pick_base_mysql_url()
_TEST_DB_NAME = _worker_db_name(_BASE_MYSQL_URL)
_TEST_DATABASE_URL = _replace_db_name(_BASE_MYSQL_URL, _TEST_DB_NAME)

# Bind before any app modules that read settings / open a pool.
os.environ["DATABASE_URL"] = _TEST_DATABASE_URL


def _ensure_mysql_database(url: str) -> None:
    """CREATE DATABASE IF NOT EXISTS (as root when app user lacks CREATE)."""
    import pymysql

    parsed = _parse_mysql(url)
    db_name = (parsed.path or "/").lstrip("/")
    if not db_name:
        raise RuntimeError("test DATABASE_URL missing database name")
    host = parsed.hostname or "127.0.0.1"
    port = int(parsed.port or 3306)
    app_user = unquote(parsed.username or "recombyn")
    app_password = unquote(parsed.password or "")
    root_password = (
        os.environ.get("MYSQL_ROOT_PASSWORD") or "recombyn-root"
    ).strip()

    def _connect(user: str, password: str):
        return pymysql.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            charset="utf8mb4",
            autocommit=True,
            connect_timeout=5,
        )

    conn = None
    last_err: Exception | None = None
    # Prefer root for CREATE DATABASE (compose default user often lacks CREATE).
    for user, password in (
        ("root", root_password),
        (app_user, app_password),
    ):
        try:
            conn = _connect(user, password)
            break
        except Exception as exc:
            last_err = exc
            conn = None
    if conn is None:
        pytest.exit(
            "MySQL unreachable for API tests. Start infra with "
            "`npm run dev:infra` (or docker compose mysql), then retry.\n"
            f"Tried: {url}\n"
            f"Error: {last_err}",
            returncode=1,
        )
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"CREATE DATABASE IF NOT EXISTS `{db_name}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
            if app_user and app_user != "root":
                try:
                    cur.execute(
                        f"GRANT ALL PRIVILEGES ON `{db_name}`.* TO %s@'%%'",
                        (app_user,),
                    )
                    cur.execute(
                        f"GRANT ALL PRIVILEGES ON `{db_name}`.* TO %s@'localhost'",
                        (app_user,),
                    )
                    cur.execute("FLUSH PRIVILEGES")
                except Exception:
                    # Non-root sessions may lack GRANT — DB create alone may suffice.
                    pass
    finally:
        conn.close()


def _clear_service_db_pools() -> None:
    try:
        import app.services.db as db_mod
    except Exception:
        return
    for attr in ("_MYSQL_POOL", "_MYSQL_RO_POOL", "_PG_POOL", "_PG_RO_POOL"):
        pool = getattr(db_mod, attr, None)
        if pool is None:
            continue
        while True:
            try:
                raw = pool.get_nowait()
            except Exception:
                break
            try:
                raw.close()
            except Exception:
                pass
        setattr(db_mod, attr, None)


def _bind_test_mysql() -> None:
    """Point settings + engine at this worker's MySQL test database."""
    from app.core.config import settings
    from app.core.db import reset_engine

    settings.database_url = _TEST_DATABASE_URL
    os.environ["DATABASE_URL"] = _TEST_DATABASE_URL
    _clear_service_db_pools()
    reset_engine()


def restore_default_engine() -> None:
    """Undo engine switches so later tests share the worker MySQL DB."""
    _bind_test_mysql()


@pytest.fixture(scope="session", autouse=True)
def _session_mysql_schema() -> None:
    """CREATE DATABASE + migrate once per xdist worker."""
    _ensure_mysql_database(_TEST_DATABASE_URL)
    _bind_test_mysql()
    from app.services.db import init_schema

    init_schema()


@pytest.fixture()
def client():
    """FastAPI TestClient against the shared MySQL test DB."""
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as c:
        yield c
