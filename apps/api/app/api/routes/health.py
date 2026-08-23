"""Health / readiness checks for API, Redis, worker, intelligence."""

from fastapi import APIRouter

from app.core.config import settings

router = APIRouter(tags=["health"])


def _check_redis() -> bool:
    try:
        import redis

        client = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=1)
        return bool(client.ping())
    except Exception:
        return False


def _check_worker() -> bool:
    try:
        from worker.celery_app import celery

        inspector = celery.control.inspect(timeout=0.8)
        ping = inspector.ping()
        return bool(ping)
    except Exception:
        return False


def _check_intelligence() -> bool:
    try:
        from app.services.vision.ilp_client import ilp_enabled

        return ilp_enabled()
    except Exception:
        return False


def _check_db() -> dict:
    try:
        from sqlalchemy import text
        from sqlmodel import Session

        from app.core.db import engine
        from app.services.db import dialect, init_schema

        init_schema()
        with Session(engine) as session:
            session.execute(text("SELECT 1"))
        return {"ok": True, "dialect": dialect()}
    except Exception as err:
        return {"ok": False, "error": str(err)[:200]}


@router.get("/health")
def health():
    redis_ok = _check_redis()
    worker_ok = _check_worker() if redis_ok else False
    intelligence_ok = _check_intelligence()
    db = _check_db()

    checks = {
        "api": True,
        "database": db,
        "redis": redis_ok,
        "worker": worker_ok,
        "intelligence": intelligence_ok,
        "use_vision": settings.use_vision,
        "s3": settings.s3_enabled,
    }

    if not db.get("ok"):
        status = "degraded"
    elif redis_ok and worker_ok:
        status = "ok"
    elif redis_ok:
        status = "degraded"  # sync import may still work; async jobs queue without drain
    else:
        status = "degraded"

    return {"status": status, "checks": checks}
