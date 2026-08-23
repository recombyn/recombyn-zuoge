"""Shared pytest fixtures for API tests."""

from __future__ import annotations

import os

import pytest

# xdist workers must not share one SQLite file (Alembic stamp races).
# Force sqlite for tests — do not inherit developer MySQL from shell/.env.
_worker = (os.environ.get("PYTEST_XDIST_WORKER") or "").strip()
_DEFAULT_SQLITE = (
    f"storage/test-recombyn-{_worker}.db"
    if _worker
    else "storage/test-recombyn.db"
)
os.environ["DATABASE_URL"] = ""
os.environ["SQLITE_DB_PATH"] = _DEFAULT_SQLITE


def _bind_test_sqlite() -> None:
    """Point settings + engine at this worker's sqlite file."""
    from app.core.config import settings
    from app.core.db import reset_engine

    settings.database_url = ""
    settings.sqlite_db_path = _DEFAULT_SQLITE
    os.environ["DATABASE_URL"] = ""
    os.environ["SQLITE_DB_PATH"] = _DEFAULT_SQLITE
    reset_engine()


def restore_default_sqlite_engine() -> None:
    """Undo SQLITE_DB_PATH / engine switches so later tests share the default file."""
    _bind_test_sqlite()


@pytest.fixture(scope="session", autouse=True)
def _session_sqlite_schema() -> None:
    """Migrate once per xdist worker so tests can query without ad-hoc ensure_*."""
    _bind_test_sqlite()
    from app.services.db import init_schema

    init_schema()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """FastAPI TestClient with sqlite under tmp_path + stubbed external checks."""
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("SQLITE_DB_PATH", str(db_path))
    monkeypatch.setenv("DATABASE_URL", "")

    from app.core.config import settings
    from app.core.db import reset_engine
    from app.services.db import init_schema
    import app.services.db as db_mod

    settings.sqlite_db_path = str(db_path)
    settings.database_url = ""
    reset_engine()
    db_mod._SCHEMA_READY = False
    init_schema()

    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as c:
        yield c
    restore_default_sqlite_engine()
