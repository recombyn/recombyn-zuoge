from __future__ import annotations

from collections.abc import Callable

from fastapi import Header, HTTPException

_auth_check: Callable[[str | None], None] | None = None


def set_auth_check(fn: Callable[[str | None], None] | None) -> None:
    global _auth_check
    _auth_check = fn


def require_auth(authorization: str | None = Header(default=None)) -> None:
    if _auth_check is None:
        return
    try:
        _auth_check(authorization)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail="unauthorized") from exc
