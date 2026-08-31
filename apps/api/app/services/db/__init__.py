"""DB backend — MySQL or PostgreSQL only."""

from __future__ import annotations

import re
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterator, Literal
from urllib.parse import unquote, urlparse

from app.core.config import settings

Dialect = Literal["mysql", "postgres"]

# RLock: init_schema holds this while calling connect() → pool checkout.
_LOCK = threading.RLock()
_MYSQL_POOL: Any = None  # queue.Queue of live pymysql connections
_MYSQL_POOL_SIZE = 8
_MYSQL_RO_POOL: Any = None
_PG_POOL: Any = None
_PG_RO_POOL: Any = None
_PG_POOL_SIZE = 8
_SCHEMA_READY = False


def dialect() -> Dialect:
    url = (settings.database_url or "").strip().lower()
    if url.startswith("mysql"):
        return "mysql"
    if url.startswith("postgres://") or url.startswith("postgresql://"):
        return "postgres"
    if not url:
        raise RuntimeError(
            "DATABASE_URL is required (mysql://… or postgresql://…). "
            "Set DATABASE_URL in apps/api/.env."
        )
    raise RuntimeError(
        f"Unsupported DATABASE_URL scheme (expected mysql:// or postgresql://): "
        f"{settings.database_url[:32]}…"
    )


def _parse_mysql_url(url: str) -> dict[str, Any]:
    """
    Accept:
      mysql://user:pass@host:3306/dbname
      mysql+pymysql://user:pass@host:3306/dbname
    """
    raw = url.replace("mysql+pymysql://", "mysql://", 1)
    parsed = urlparse(raw)
    if parsed.scheme != "mysql":
        raise ValueError(f"Unsupported DATABASE_URL scheme: {parsed.scheme}")
    db = (parsed.path or "/").lstrip("/") or "recombyn"
    return {
        "host": parsed.hostname or "127.0.0.1",
        "port": int(parsed.port or 3306),
        "user": unquote(parsed.username or "root"),
        "password": unquote(parsed.password or ""),
        "database": db,
        "charset": "utf8mb4",
        "autocommit": False,
        "cursorclass": None,  # set after import
    }


def _mysql_apply_connection_collation(conn: Any) -> None:
    """Force connection collation to match seeded tables (avoid MySQL 1267 mix)."""
    try:
        with conn.cursor() as cur:
            cur.execute("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci")
    except Exception:
        pass


def _mysql_connect_new(url: str | None = None):
    import pymysql
    from pymysql.cursors import DictCursor

    cfg = _parse_mysql_url((url or settings.database_url).strip())
    cfg["cursorclass"] = DictCursor
    cfg["connect_timeout"] = 10
    cfg["read_timeout"] = 60
    cfg["write_timeout"] = 60
    conn = pymysql.connect(
        **{k: v for k, v in cfg.items() if k != "cursorclass"},
        cursorclass=DictCursor,
    )
    _mysql_apply_connection_collation(conn)
    return conn


def _mysql_pool_slot(*, readonly: bool) -> Any:
    global _MYSQL_POOL, _MYSQL_RO_POOL
    import queue

    with _LOCK:
        if readonly:
            if _MYSQL_RO_POOL is None:
                _MYSQL_RO_POOL = queue.Queue(maxsize=_MYSQL_POOL_SIZE)
                _MYSQL_RO_POOL._opened = 0  # type: ignore[attr-defined]
            return _MYSQL_RO_POOL
        if _MYSQL_POOL is None:
            _MYSQL_POOL = queue.Queue(maxsize=_MYSQL_POOL_SIZE)
            _MYSQL_POOL._opened = 0  # type: ignore[attr-defined]
        return _MYSQL_POOL


def _mysql_pool_get(*, readonly: bool = False):
    """Borrow a pooled connection; create up to _MYSQL_POOL_SIZE."""
    pool = _mysql_pool_slot(readonly=readonly)
    url = (
        (settings.database_readonly_url or "").strip()
        if readonly and (settings.database_readonly_url or "").strip()
        else settings.database_url.strip()
    )

    def _mark_pooled(conn: Any) -> Any:
        setattr(conn, "_rcb_pooled", True)
        setattr(conn, "_rcb_readonly", bool(readonly))
        return conn

    try:
        raw = pool.get_nowait()
    except Exception:
        raw = None

    if raw is not None:
        try:
            raw.ping(reconnect=True)
            _mysql_apply_connection_collation(raw)
            return _mark_pooled(raw)
        except Exception:
            try:
                raw.close()
            except Exception:
                pass
            with _LOCK:
                pool._opened = max(0, int(getattr(pool, "_opened", 1)) - 1)  # type: ignore[attr-defined]

    create = False
    with _LOCK:
        opened = int(getattr(pool, "_opened", 0))
        if opened < _MYSQL_POOL_SIZE:
            pool._opened = opened + 1  # type: ignore[attr-defined]
            create = True

    if create:
        try:
            return _mark_pooled(_mysql_connect_new(url))
        except Exception:
            with _LOCK:
                pool._opened = max(0, int(getattr(pool, "_opened", 1)) - 1)  # type: ignore[attr-defined]
            raise

    deadline = time.monotonic() + 15.0
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("MySQL connection pool exhausted")
        try:
            raw = pool.get(timeout=remaining)
        except Exception:
            raise TimeoutError("MySQL connection pool exhausted") from None
        try:
            raw.ping(reconnect=True)
            _mysql_apply_connection_collation(raw)
            return _mark_pooled(raw)
        except Exception:
            try:
                raw.close()
            except Exception:
                pass
            with _LOCK:
                pool._opened = max(0, int(getattr(pool, "_opened", 1)) - 1)  # type: ignore[attr-defined]


def _mysql_pool_put(raw: Any, *, readonly: bool = False) -> None:
    pool = _MYSQL_RO_POOL if readonly else _MYSQL_POOL
    if pool is None or not getattr(raw, "_rcb_pooled", False):
        try:
            raw.close()
        except Exception:
            pass
        return
    try:
        try:
            raw.rollback()
        except Exception:
            pass
        pool.put_nowait(raw)
    except Exception:
        try:
            raw.close()
        except Exception:
            pass
        with _LOCK:
            if hasattr(pool, "_opened"):
                pool._opened = max(0, int(pool._opened) - 1)  # type: ignore[attr-defined]


def _parse_postgres_url(url: str) -> str:
    """Normalize to postgresql:// for psycopg."""
    raw = (url or "").strip()
    if raw.startswith("postgres://"):
        return "postgresql://" + raw[len("postgres://") :]
    return raw


def _pg_connect_new(url: str | None = None):
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as err:
        raise RuntimeError(
            "PostgreSQL support requires psycopg. Install with: "
            "pip install 'psycopg[binary]>=3.1'"
        ) from err

    dsn = _parse_postgres_url(url or settings.database_url)
    return psycopg.connect(dsn, row_factory=dict_row, autocommit=False)


def _pg_pool_slot(*, readonly: bool) -> Any:
    global _PG_POOL, _PG_RO_POOL
    import queue

    with _LOCK:
        if readonly:
            if _PG_RO_POOL is None:
                _PG_RO_POOL = queue.Queue(maxsize=_PG_POOL_SIZE)
                _PG_RO_POOL._opened = 0  # type: ignore[attr-defined]
            return _PG_RO_POOL
        if _PG_POOL is None:
            _PG_POOL = queue.Queue(maxsize=_PG_POOL_SIZE)
            _PG_POOL._opened = 0  # type: ignore[attr-defined]
        return _PG_POOL


def _pg_pool_get(*, readonly: bool = False):
    pool = _pg_pool_slot(readonly=readonly)
    url = (
        (settings.database_readonly_url or "").strip()
        if readonly and (settings.database_readonly_url or "").strip()
        else settings.database_url.strip()
    )

    def _mark(conn: Any) -> Any:
        setattr(conn, "_rcb_pooled", True)
        setattr(conn, "_rcb_readonly", bool(readonly))
        return conn

    try:
        raw = pool.get_nowait()
    except Exception:
        raw = None
    if raw is not None:
        try:
            if raw.closed:
                raise RuntimeError("closed")
            return _mark(raw)
        except Exception:
            try:
                raw.close()
            except Exception:
                pass
            with _LOCK:
                pool._opened = max(0, int(getattr(pool, "_opened", 1)) - 1)  # type: ignore[attr-defined]

    create = False
    with _LOCK:
        opened = int(getattr(pool, "_opened", 0))
        if opened < _PG_POOL_SIZE:
            pool._opened = opened + 1  # type: ignore[attr-defined]
            create = True
    if create:
        try:
            return _mark(_pg_connect_new(url))
        except Exception:
            with _LOCK:
                pool._opened = max(0, int(getattr(pool, "_opened", 1)) - 1)  # type: ignore[attr-defined]
            raise

    deadline = time.monotonic() + 15.0
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("PostgreSQL connection pool exhausted")
        try:
            raw = pool.get(timeout=remaining)
        except Exception:
            raise TimeoutError("PostgreSQL connection pool exhausted") from None
        try:
            if raw.closed:
                raise RuntimeError("closed")
            return _mark(raw)
        except Exception:
            try:
                raw.close()
            except Exception:
                pass
            with _LOCK:
                pool._opened = max(0, int(getattr(pool, "_opened", 1)) - 1)  # type: ignore[attr-defined]


def _pg_pool_put(raw: Any, *, readonly: bool = False) -> None:
    pool = _PG_RO_POOL if readonly else _PG_POOL
    if pool is None or not getattr(raw, "_rcb_pooled", False):
        try:
            raw.close()
        except Exception:
            pass
        return
    try:
        try:
            raw.rollback()
        except Exception:
            pass
        pool.put_nowait(raw)
    except Exception:
        try:
            raw.close()
        except Exception:
            pass
        with _LOCK:
            if hasattr(pool, "_opened"):
                pool._opened = max(0, int(pool._opened) - 1)  # type: ignore[attr-defined]


def _adapt_sql(sql: str) -> str:
    """Normalize app SQL for the active dialect (MySQL / PostgreSQL)."""
    d = dialect()
    out = sql
    out = out.replace("COLLATE NOCASE", "")
    if d == "mysql":
        out = out.replace("AUTOINCREMENT", "AUTO_INCREMENT")
        out = re.sub(
            r"\blast_insert_rowid\s*\(\s*\)",
            "LAST_INSERT_ID()",
            out,
            flags=re.IGNORECASE,
        )
        out = re.sub(
            r"ON CONFLICT\((\w+)\)\s+DO UPDATE SET",
            r"ON DUPLICATE KEY UPDATE",
            out,
            flags=re.IGNORECASE,
        )
        out = re.sub(r"excluded\.(\w+)", r"VALUES(\1)", out, flags=re.IGNORECASE)
    else:
        # PostgreSQL: keep ON CONFLICT / excluded.*; map helpers.
        out = re.sub(
            r"\blast_insert_rowid\s*\(\s*\)",
            "lastval()",
            out,
            flags=re.IGNORECASE,
        )
        out = out.replace("AUTOINCREMENT", "")
        out = re.sub(r"\bBEGIN\s+IMMEDIATE\b", "BEGIN", out, flags=re.IGNORECASE)
    # pymysql / psycopg use %s placeholders; escape literal % first.
    out = out.replace("%", "%%")
    out = out.replace("?", "%s")
    return out


class CursorWrapper:
    def __init__(self, cur: Any, dialect_name: Dialect):
        self._cur = cur
        self._dialect = dialect_name

    def execute(self, sql: str, params: Any = ()):
        adapted = _adapt_sql(sql)
        if params is None:
            params = ()
        self._cur.execute(adapted, params)
        return self

    def executemany(self, sql: str, seq: Any):
        adapted = _adapt_sql(sql)
        self._cur.executemany(adapted, seq)
        return self

    def executescript(self, script: str):
        for stmt in _split_sql(script):
            stmt = stmt.strip()
            if not stmt:
                continue
            self._cur.execute(_adapt_sql(stmt))
        return self

    def fetchone(self):
        row = self._cur.fetchone()
        if row is None:
            return None
        return _DictRow(row)

    def fetchall(self):
        rows = self._cur.fetchall()
        return [_DictRow(r) for r in rows]

    @property
    def lastrowid(self):
        return self._cur.lastrowid

    @property
    def rowcount(self):
        return self._cur.rowcount


class _DictRow(dict):
    """Dict-row access with integer index support (MySQL/PostgreSQL)."""

    def __getitem__(self, key: Any) -> Any:
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class ConnectionWrapper:
    def __init__(self, conn: Any, dialect_name: Dialect):
        self._conn = conn
        self.dialect = dialect_name

    def execute(self, sql: str, params: Any = ()):
        cur = self._conn.cursor()
        wrapper = CursorWrapper(cur, self.dialect)
        wrapper.execute(sql, params)
        return wrapper

    def executemany(self, sql: str, seq: Any):
        cur = self._conn.cursor()
        wrapper = CursorWrapper(cur, self.dialect)
        wrapper.executemany(sql, seq)
        return wrapper

    def executescript(self, script: str):
        cur = self._conn.cursor()
        wrapper = CursorWrapper(cur, self.dialect)
        wrapper.executescript(script)
        return wrapper

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()


def _split_sql(script: str) -> list[str]:
    parts: list[str] = []
    buf: list[str] = []
    in_str = False
    quote = ""
    for ch in script:
        if in_str:
            buf.append(ch)
            if ch == quote:
                in_str = False
            continue
        if ch in ("'", '"'):
            in_str = True
            quote = ch
            buf.append(ch)
            continue
        if ch == ";":
            parts.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    if buf:
        parts.append("".join(buf))
    return parts


@contextmanager
def connect(
    *,
    readonly: bool = False,
    immediate: bool = False,
) -> Iterator[ConnectionWrapper]:
    """Yield a connection; commits on success, rolls back on error.

    - ``readonly``: prefer read replica (``DATABASE_READONLY_URL``).
    - ``immediate``: MySQL ``START TRANSACTION`` / Postgres ``BEGIN``.
      Prefer for wallet / balance mutations.
    """
    d = dialect()
    pooled = False
    raw: Any = None
    conn: ConnectionWrapper | None = None

    try:
        if d == "mysql":
            raw = _mysql_pool_get(readonly=readonly)
            conn = ConnectionWrapper(raw, "mysql")
            pooled = True
        else:
            raw = _pg_pool_get(readonly=readonly)
            conn = ConnectionWrapper(raw, "postgres")
            pooled = True

        assert conn is not None
        if immediate and not readonly:
            if d == "mysql":
                conn.execute("START TRANSACTION")
            else:
                conn.execute("BEGIN")

        try:
            yield conn
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise
    finally:
        if pooled and raw is not None:
            if d == "mysql":
                _mysql_pool_put(raw, readonly=readonly)
            else:
                _pg_pool_put(raw, readonly=readonly)
        elif conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def begin_write(conn: ConnectionWrapper) -> None:
    """Take a write transaction on an open connection (wallet / critical sections)."""
    if conn.dialect == "mysql":
        conn.execute("START TRANSACTION")
    else:
        conn.execute("BEGIN")


def init_schema() -> None:
    """Ensure schema is at Alembic head."""
    global _SCHEMA_READY
    with _LOCK:
        if _SCHEMA_READY:
            return
        from app.core.db import run_migrations

        run_migrations()
        _SCHEMA_READY = True
