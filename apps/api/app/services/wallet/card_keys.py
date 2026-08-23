"""Card-key generation, hashing, and redemption.

Kinds:
  - credit: top up unified 积分
  - plan: sets membership + monthly 积分 gift

Pipeline:
  1. Local random plaintext (XXXXX-XXXXX-XXXXX-XXXXX, no ambiguous chars)
  2. hash = HMAC-SHA256(plaintext, CARD_KEY_SALT)
  3. DB stores hash + kind/plan/tokens + status + expires_at (never plaintext)
  4. Redeem: hash → lookup → credit 积分 and/or set plan

Format v2: 4×5 segments (20 chars).
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Any

from app.core.config import settings
from app.services.wallet.db import init_wallet_db

# Exclude 0/O, 1/I/L — reduce mistype / OCR confusion.
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_SEG_LEN = 5
_SEG_COUNT = 4  # XXXXX-XXXXX-XXXXX-XXXXX → 20 charset chars
_KEY_BODY_LEN = _SEG_LEN * _SEG_COUNT

_WEAK_SALTS = frozenset(
    {
        "",
        "change-me",
        "change-me-to-a-long-random-string",
        "replace-with-secrets-token-urlsafe-32",
        "secret",
        "salt",
        "card_key_salt",
        "recombyn",
    }
)
_MIN_SALT_LEN = 24

# Keep in sync with FE PLAN_CATALOG (apps/web/src/utils/wallet.ts)
# and billing.PLUS_IMAGE_FACE_CREDITS (¥49 → 340 积分).
PLAN_CREDITS: dict[str, int] = {
    "plus": 340,
    "pro": 1030,
    "ultra": 4000,
}
VALID_PLAN_IDS = frozenset(PLAN_CREDITS.keys())
VALID_KINDS = frozenset({"credit", "plan"})
# Membership length after redeeming a plan card key (calendar days).
PLAN_DURATION_DAYS = 30

_V2_MIGRATION_ID = "card_keys_v2_hmac_long"
_v2_ready = False


def require_strong_card_key_salt() -> str:
    """Reject empty / placeholder salts used in .env.example."""
    salt = (settings.card_key_salt or "").strip()
    if len(salt) < _MIN_SALT_LEN or salt.lower() in _WEAK_SALTS:
        raise ValueError(
            f"CARD_KEY_SALT must be a strong random string (len>={_MIN_SALT_LEN}); "
            "do not use the example placeholder"
        )
    return salt


def normalize_card_key(raw: str) -> str:
    """Uppercase alnum → XXXXX-XXXXX-XXXXX-XXXXX (v2 only)."""
    chars = "".join(ch for ch in (raw or "").upper() if ch.isalnum())
    if len(chars) == _KEY_BODY_LEN:
        parts = [chars[i : i + _SEG_LEN] for i in range(0, _KEY_BODY_LEN, _SEG_LEN)]
        return "-".join(parts)
    parts = [p for p in (raw or "").upper().replace(" ", "").split("-") if p]
    if len(parts) == _SEG_COUNT and all(len(p) == _SEG_LEN for p in parts):
        return "-".join(parts)
    return (raw or "").strip().upper()


def is_valid_card_key_format(key: str) -> bool:
    """True when normalized key is exactly 4 segments of 5 alphabet chars."""
    norm = normalize_card_key(key)
    parts = norm.split("-")
    if len(parts) != _SEG_COUNT:
        return False
    if any(len(p) != _SEG_LEN for p in parts):
        return False
    body = "".join(parts)
    return len(body) == _KEY_BODY_LEN and all(ch in _ALPHABET for ch in body)


def generate_plaintext_key() -> str:
    parts = [
        "".join(secrets.choice(_ALPHABET) for _ in range(_SEG_LEN))
        for _ in range(_SEG_COUNT)
    ]
    return "-".join(parts)


def hash_card_key(plaintext: str, salt: str | None = None) -> str:
    key = normalize_card_key(plaintext)
    use_salt = salt if salt is not None else require_strong_card_key_salt()
    return hmac.new(
        use_salt.encode("utf-8"),
        key.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def ensure_card_keys_v2() -> None:
    """One-shot: wipe all short/SHA256 keys (format + hash changed)."""
    global _v2_ready
    if _v2_ready:
        return
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_wallet_db()
    now = time.time()
    with Session(engine) as session:
        crud.ensure_app_migrations_table(session=session)
        if not crud.app_migration_applied(session=session, migration_id=_V2_MIGRATION_ID):
            crud.delete_all_card_keys(session=session)
            crud.mark_app_migration(
                session=session, migration_id=_V2_MIGRATION_ID, applied_at=now
            )
    _v2_ready = True


def normalize_plan_id(raw: Any) -> str:
    pid = str(raw or "").strip().lower()
    if pid in VALID_PLAN_IDS or pid == "free":
        return pid
    return "free"


def _normalize_topup_amount(amount: int) -> int:
    """Normalize top-up amounts to unified 积分."""
    return int(amount or 0)


def resolve_generate_spec(
    *,
    kind: str,
    credits: int,
    plan_id: str | None,
) -> tuple[str, int, str | None]:
    """
    Normalize generate inputs → (kind, amount, plan_id).
    Top-ups are stored as kind=credit (积分).
    DB column ``tokens`` stores the 积分 face value.
    """
    k = str(kind or "credit").strip().lower()
    if k not in VALID_KINDS:
        raise ValueError("kind must be credit or plan")
    if k == "plan":
        pid = normalize_plan_id(plan_id)
        if pid not in VALID_PLAN_IDS:
            raise ValueError("planId must be plus, pro, or ultra")
        amt = int(credits or 0)
        if amt <= 0:
            from app.services.wallet.billing import plan_credit_grant

            amt = int(plan_credit_grant(pid) or PLAN_CREDITS[pid])
        return "plan", amt, pid
    amt = _normalize_topup_amount(int(credits or 0))
    if amt <= 0:
        raise ValueError("amount must be > 0 for credit keys")
    return "credit", amt, None


def _row_out(
    *,
    kid: Any,
    code: str | None,
    credits: int,
    kind: str,
    plan_id: str | None,
    status: str,
    created_at: float,
    expires_at: float | None,
    redeemed_at: float | None,
) -> dict[str, Any]:
    return {
        "id": str(kid),
        "code": code,
        "credits": int(credits),
        "kind": kind,
        "planId": plan_id,
        "status": status,
        "createdAt": float(created_at),
        "expiresAt": float(expires_at) if expires_at is not None else None,
        "redeemedAt": float(redeemed_at) if redeemed_at is not None else None,
    }


def insert_card_keys(
    *,
    plaintexts: list[str],
    credits: int,
    expires_at: float | None,
    kind: str = "credit",
    plan_id: str | None = None,
) -> int:
    """Insert hashes for generated keys. Returns number inserted."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    kind_n, credits_n, plan_n = resolve_generate_spec(
        kind=kind, credits=credits, plan_id=plan_id
    )
    ensure_card_keys_v2()
    require_strong_card_key_salt()
    now = time.time()
    inserted = 0
    with Session(engine) as session:
        for plain in plaintexts:
            row = crud.create_card_key(
                session=session,
                key_hash=hash_card_key(plain),
                credits=credits_n,
                kind=kind_n,
                plan_id=plan_n,
                expires_at=expires_at,
                created_at=now,
                commit=False,
            )
            if row:
                inserted += 1
        session.commit()
    return inserted


def generate_card_keys(
    *,
    count: int,
    credits: int = 0,
    expires_days: int = 0,
    kind: str = "credit",
    plan_id: str | None = None,
) -> list[dict[str, Any]]:
    """Generate unique keys, hash+store, return plaintext rows once (with ids)."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    if count <= 0 or count > 500:
        raise ValueError("count must be 1..500")
    require_strong_card_key_salt()
    ensure_card_keys_v2()

    kind_n, credits_n, plan_n = resolve_generate_spec(
        kind=kind, credits=credits, plan_id=plan_id
    )

    expires_at = None
    if expires_days and expires_days > 0:
        expires_at = time.time() + expires_days * 86400

    plaintexts: list[str] = []
    seen: set[str] = set()
    while len(plaintexts) < count:
        k = generate_plaintext_key()
        if k in seen:
            continue
        seen.add(k)
        plaintexts.append(k)

    init_wallet_db()
    now = time.time()
    rows: list[dict[str, Any]] = []
    with Session(engine) as session:
        for plain in plaintexts:
            row = crud.create_card_key(
                session=session,
                key_hash=hash_card_key(plain),
                credits=credits_n,
                kind=kind_n,
                plan_id=plan_n,
                expires_at=expires_at,
                created_at=now,
                commit=False,
            )
            if not row:
                continue
            rows.append(
                _row_out(
                    kid=row.id,
                    code=plain,
                    credits=credits_n,
                    kind=kind_n,
                    plan_id=plan_n,
                    status="unused",
                    created_at=now,
                    expires_at=expires_at,
                    redeemed_at=None,
                )
            )
        session.commit()
    return rows


def list_card_keys(*, status: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
    """List card keys for admin (no plaintext — only hashes stored)."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_card_keys_v2()
    with Session(engine) as session:
        db_rows = crud.list_card_keys(session=session, status=status, limit=limit)
    out: list[dict[str, Any]] = []
    for row in db_rows:
        kind = str(row.kind or "credit").strip().lower() or "credit"
        plan_raw = row.plan_id
        plan_id = str(plan_raw).strip().lower() if plan_raw else None
        out.append(
            _row_out(
                kid=row.id,
                code=None,
                credits=int(row.credits or 0),
                kind=kind if kind in VALID_KINDS else "credit",
                plan_id=plan_id if plan_id in VALID_PLAN_IDS else None,
                status=str(row.status),
                created_at=float(row.created_at),
                expires_at=row.expires_at,
                redeemed_at=row.redeemed_at,
            )
        )
    return out


def revoke_card_keys(ids: list[str] | list[int]) -> dict[str, Any]:
    """Mark unused keys as revoked (作废). Returns { revoked, skipped }."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_card_keys_v2()
    clean: list[int] = []
    for raw in ids or []:
        try:
            clean.append(int(raw))
        except (TypeError, ValueError):
            continue
    if not clean:
        return {"revoked": 0, "skipped": 0}
    with Session(engine) as session:
        revoked = crud.revoke_unused_card_keys(session=session, ids=clean)
    return {"revoked": revoked, "skipped": max(0, len(clean) - revoked)}


class RedeemError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def redeem_card_key(user_id: str, plaintext: str) -> dict[str, Any]:
    """Atomically redeem a key. Raises RedeemError on failure."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine
    from app.models import UserBalance
    from app.services.wallet.db import init_wallet_db

    init_wallet_db()
    ensure_card_keys_v2()
    try:
        require_strong_card_key_salt()
    except ValueError as err:
        raise RedeemError("misconfigured", str(err)) from err
    key = normalize_card_key(plaintext)
    if not is_valid_card_key_format(key):
        raise RedeemError("invalid_format", "Invalid card key format")

    digest = hash_card_key(key)
    now = time.time()

    with Session(engine) as session:
        try:
            row = crud.get_card_key_by_hash_for_update(session=session, key_hash=digest)
            if not row:
                raise RedeemError("not_found", "Card key not found")
            if row.status == "used":
                raise RedeemError("already_used", "Card key already redeemed")
            if row.status == "revoked":
                raise RedeemError("revoked", "Card key revoked")
            expires = row.expires_at
            if expires is not None and float(expires) < now:
                raise RedeemError("expired", "Card key expired")

            kind = str(row.kind or "credit").strip().lower() or "credit"
            if kind not in VALID_KINDS:
                raise RedeemError("invalid_kind", "Card key kind is invalid")
            plan_raw = row.plan_id
            plan_id = str(plan_raw).strip().lower() if plan_raw else None
            if kind == "plan" and plan_id not in VALID_PLAN_IDS:
                raise RedeemError("invalid_plan", "Card key plan is invalid")

            amount = max(0, int(row.credits or 0))
            bal = crud.get_user_balance_for_update(session=session, user_id=user_id)
            prev_credits = int(bal.credits) if bal else 0
            prev_plan = normalize_plan_id(bal.plan_id) if bal else "free"
            prev_exp_raw = bal.plan_expires_at if bal else None
            prev_expires = float(prev_exp_raw) if prev_exp_raw is not None else None
            prev_active = (
                prev_plan in VALID_PLAN_IDS
                and prev_expires is not None
                and prev_expires > now
            )

            next_plan = prev_plan
            next_expires = prev_expires
            gift = 0

            if kind == "plan" and plan_id:
                if prev_active and plan_id != prev_plan:
                    raise RedeemError(
                        "plan_locked",
                        "Current plan is still active; switch only after it expires",
                    )
                next_plan = plan_id
                base = now
                if prev_active and plan_id == prev_plan and prev_expires and prev_expires > now:
                    base = prev_expires
                next_expires = base + PLAN_DURATION_DAYS * 86400
                gift = amount if amount > 0 else int(PLAN_CREDITS.get(plan_id) or 0)
                amount = gift
            else:
                gift = _normalize_topup_amount(amount)
                amount = gift
            if gift <= 0:
                raise RedeemError("invalid_amount", "Card key amount invalid")

            next_credits = prev_credits + gift

            if bal:
                bal.credits = next_credits
                bal.plan_id = next_plan
                bal.plan_expires_at = next_expires
                bal.updated_at = now
                session.add(bal)
            else:
                session.add(
                    UserBalance(
                        user_id=user_id,
                        credits=next_credits,
                        plan_id=next_plan,
                        plan_expires_at=next_expires,
                        updated_at=now,
                    )
                )

            if row.status != "unused":
                raise RedeemError("already_used", "Card key already redeemed")
            row.status = "used"
            row.redeemed_by = user_id
            row.redeemed_at = now
            session.add(row)

            detail = (
                f"套餐卡密兑换:{next_plan}"
                if kind == "plan"
                else "积分卡密兑换"
            )
            ledger = crud.add_wallet_ledger(
                session=session,
                user_id=user_id,
                kind="plan" if kind == "plan" else "redeem",
                amount=gift,
                balance_after=next_credits,
                detail=detail,
            )
            ledger.card_key_id = row.id
            session.add(ledger)
            session.commit()
        except RedeemError:
            session.rollback()
            raise
        except Exception:
            session.rollback()
            raise

    return {
        "kind": "plan" if kind == "plan" else "credit",
        "creditsAdded": gift,
        "credits": next_credits,
        "planId": next_plan if (
            next_plan == "free"
            or next_expires is None
            or float(next_expires) > time.time()
        ) else "free",
        "planExpiresAt": next_expires,
        "planLocked": bool(
            next_plan in VALID_PLAN_IDS
            and next_expires is not None
            and float(next_expires) > time.time()
        ),
    }


# --- Redeem rate limit (in-memory; per-process) ---
# Caps online guessing of long card keys.
_REDEEM_WINDOW_SEC = 15 * 60
_REDEEM_MAX_USER = 8
_REDEEM_MAX_IP = 40

@dataclass
class _RedeemBucket:
    count: int = 0
    first_at: float = 0.0


_redeem_lock = threading.Lock()
_redeem_fails: dict[str, _RedeemBucket] = {}


def _redeem_purge(now: float) -> None:
    dead = [
        k
        for k, v in _redeem_fails.items()
        if v.first_at and now - v.first_at > _REDEEM_WINDOW_SEC
    ]
    for k in dead:
        _redeem_fails.pop(k, None)


def check_redeem_rate_limit(*, user_id: str, ip: str | None = None) -> None:
    """
    Raise RedeemError(rate_limited) if user/IP exceeded attempt budget.
    Call before redeem; count every attempt via record_redeem_attempt.
    """
    now = time.time()
    uid = (user_id or "").strip()
    ip_n = (ip or "").strip()
    with _redeem_lock:
        _redeem_purge(now)
        keys: list[tuple[str, int]] = []
        if uid:
            keys.append((f"u:{uid}", _REDEEM_MAX_USER))
        if ip_n:
            keys.append((f"ip:{ip_n}", _REDEEM_MAX_IP))
        for key, lim in keys:
            bucket = _redeem_fails.get(key)
            if not bucket or not bucket.first_at:
                continue
            if now - bucket.first_at > _REDEEM_WINDOW_SEC:
                continue
            if bucket.count >= lim:
                retry = max(1, int(_REDEEM_WINDOW_SEC - (now - bucket.first_at)))
                raise RedeemError(
                    "rate_limited",
                    f"Too many redeem attempts; retry in {retry}s",
                )


def record_redeem_attempt(*, user_id: str, ip: str | None = None) -> None:
    """Count one redeem attempt (success or failure) toward the window budget."""
    now = time.time()
    uid = (user_id or "").strip()
    ip_n = (ip or "").strip()
    with _redeem_lock:
        _redeem_purge(now)
        for key in ([f"u:{uid}"] if uid else []) + ([f"ip:{ip_n}"] if ip_n else []):
            bucket = _redeem_fails.get(key)
            if not bucket or not bucket.first_at or now - bucket.first_at > _REDEEM_WINDOW_SEC:
                _redeem_fails[key] = _RedeemBucket(count=1, first_at=now)
            else:
                bucket.count += 1


def clear_redeem_rate_limit(*, user_id: str, ip: str | None = None) -> None:
    """Clear counters after a successful redeem (user only; keep IP soft cap)."""
    uid = (user_id or "").strip()
    if not uid:
        return
    with _redeem_lock:
        _redeem_fails.pop(f"u:{uid}", None)
