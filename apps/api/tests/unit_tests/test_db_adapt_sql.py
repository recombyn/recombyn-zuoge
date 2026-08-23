"""SQL dialect adaptation for MySQL vs SQLite."""

from __future__ import annotations

from unittest.mock import patch

from app.services.db import _adapt_sql


def test_adapt_sql_rewrites_last_insert_rowid_for_mysql() -> None:
    with patch("app.services.db.dialect", return_value="mysql"):
        out = _adapt_sql("SELECT last_insert_rowid() AS id")
    assert "LAST_INSERT_ID()" in out
    assert "last_insert_rowid" not in out.lower()


def test_adapt_sql_leaves_last_insert_rowid_on_sqlite() -> None:
    with patch("app.services.db.dialect", return_value="sqlite"):
        sql = "SELECT last_insert_rowid() AS id"
        assert _adapt_sql(sql) == sql


def test_adapt_sql_placeholders_and_upsert_for_mysql() -> None:
    with patch("app.services.db.dialect", return_value="mysql"):
        out = _adapt_sql(
            "INSERT INTO t (a) VALUES (?) ON CONFLICT(a) DO UPDATE SET b = excluded.b"
        )
    assert "%s" in out
    assert "?" not in out
    assert "ON DUPLICATE KEY UPDATE" in out
    assert "VALUES(b)" in out
