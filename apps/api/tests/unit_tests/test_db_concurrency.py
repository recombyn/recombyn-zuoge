# -*- coding: utf-8 -*-
"""DB concurrency: SQLite WAL, write lock, backup."""
from __future__ import annotations

import sqlite3
from pathlib import Path


def test_dialect_sqlite_default(monkeypatch):
    from app.core.config import settings
    from app.services import db as dbmod

    monkeypatch.setattr(settings, "database_url", "")
    assert dbmod.dialect() == "sqlite"


def test_dialect_rejects_unknown(monkeypatch):
    from app.core.config import settings
    from app.services import db as dbmod

    monkeypatch.setattr(settings, "database_url", "oracle://x")
    try:
        dbmod.dialect()
        assert False, "expected RuntimeError"
    except RuntimeError:
        pass


def test_dialect_postgres(monkeypatch):
    from app.core.config import settings
    from app.services import db as dbmod

    monkeypatch.setattr(settings, "database_url", "postgresql://u:p@localhost/db")
    assert dbmod.dialect() == "postgres"
    monkeypatch.setattr(settings, "database_url", "postgres://u:p@localhost/db")
    assert dbmod.dialect() == "postgres"


def test_sqlite_wal_and_busy(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.services import db as dbmod

    monkeypatch.setattr(settings, "database_url", "")
    monkeypatch.setattr(settings, "sqlite_db_path", str(tmp_path / "t.db"))
    monkeypatch.setattr(settings, "sqlite_wal", True)
    monkeypatch.setattr(settings, "sqlite_busy_timeout_ms", 15000)
    dbmod._SCHEMA_READY = False

    with dbmod.connect() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)")
        conn.execute("INSERT INTO t (v) VALUES (?)", ("a",))
    # Re-open and check pragma
    raw = sqlite3.connect(str(tmp_path / "t.db"))
    mode = raw.execute("PRAGMA journal_mode").fetchone()[0]
    assert str(mode).lower() == "wal"
    raw.close()

    with dbmod.connect(immediate=True) as conn:
        conn.execute("UPDATE t SET v = ? WHERE id = 1", ("b",))


def test_sqlite_readonly(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.services import db as dbmod

    monkeypatch.setattr(settings, "database_url", "")
    monkeypatch.setattr(settings, "sqlite_db_path", str(tmp_path / "ro.db"))
    dbmod._SCHEMA_READY = False
    with dbmod.connect() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)")
        conn.execute("INSERT INTO t (v) VALUES (?)", ("x",))
    with dbmod.connect(readonly=True) as conn:
        row = conn.execute("SELECT v FROM t LIMIT 1").fetchone()
        assert row["v"] == "x"


def test_backup_sqlite(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.services import db as dbmod
    from app.services.db.backup import run_db_backup

    monkeypatch.setattr(settings, "database_url", "")
    monkeypatch.setattr(settings, "sqlite_db_path", str(tmp_path / "src.db"))
    monkeypatch.setattr(settings, "db_backup_dir", str(tmp_path / "backups"))
    monkeypatch.setattr(settings, "db_backup_enabled", True)
    monkeypatch.setattr(settings, "db_backup_keep", 3)
    dbmod._SCHEMA_READY = False

    with dbmod.connect() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)")
        conn.execute("INSERT INTO t DEFAULT VALUES")

    result = run_db_backup(reason="unit")
    assert result["ok"]
    assert result["files"]
    assert Path(result["files"][0]).is_file()
