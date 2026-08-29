# -*- coding: utf-8 -*-
"""DB dialect / connect / backup (MySQL-only)."""
from __future__ import annotations

from pathlib import Path


def test_dialect_mysql_default(monkeypatch):
    from app.core.config import settings
    from app.services import db as dbmod

    monkeypatch.setattr(
        settings, "database_url", "mysql://recombyn:recombyn@127.0.0.1:3306/recombyn_test"
    )
    assert dbmod.dialect() == "mysql"


def test_dialect_rejects_empty(monkeypatch):
    from app.core.config import settings
    from app.services import db as dbmod

    monkeypatch.setattr(settings, "database_url", "")
    try:
        dbmod.dialect()
        assert False, "expected RuntimeError"
    except RuntimeError:
        pass


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


def test_mysql_connect_and_immediate():
    from app.services import db as dbmod

    assert dbmod.dialect() == "mysql"
    with dbmod.connect() as conn:
        row = conn.execute("SELECT ? AS v", ("a",)).fetchone()
        assert row["v"] == "a"
    with dbmod.connect(immediate=True) as conn:
        row = conn.execute("SELECT 1 AS ok").fetchone()
        assert int(row["ok"]) == 1


def test_mysql_readonly():
    from app.services import db as dbmod

    # Without DATABASE_READONLY_URL, readonly uses the primary pool.
    with dbmod.connect(readonly=True) as conn:
        row = conn.execute("SELECT 1 AS ok").fetchone()
        assert int(row["ok"]) == 1


def test_backup_mysql_hint(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.services.db.backup import run_db_backup

    monkeypatch.setattr(settings, "db_backup_dir", str(tmp_path / "backups"))
    monkeypatch.setattr(settings, "db_backup_enabled", True)
    monkeypatch.setattr(settings, "db_backup_keep", 3)

    result = run_db_backup(reason="unit")
    assert result["ok"]
    assert result["dialect"] == "mysql"
    assert result["files"]
    assert Path(result["files"][0]).is_file()
