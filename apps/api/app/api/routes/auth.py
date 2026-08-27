"""Auth API — Google OAuth + email verification-code login."""

from __future__ import annotations

import hmac
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, SessionDep, TokenDep
from app.core.config import settings
from app.models import AuthConfigOut, AuthMeOut, AuthSessionOut, Message
from app.services.auth import SessionUser, create_session, revoke_session
from app.services.auth.admin import (
    SUPER_ADMIN_BOOTSTRAP_PASSWORD,
    SUPER_ADMIN_EMAIL,
    SUPER_ADMIN_ID,
)
from app.services.admin.users import ensure_super_admin_role
from app.services.auth.email_store import (
    can_send_code,
    consume_activate_token,
    consume_ticket,
    ensure_email_user,
    generate_code,
    store_code,
    update_profile,
    verify_and_issue_ticket,
)
from app.services.auth.google import login_with_google_auth_code, login_with_google_credential
from app.services.auth.ses_mail import SesError, send_verification_email, ses_configured
from app.services.auth.slider_captcha import (
    captcha_required,
    clear_login_failures,
    consume_captcha_token,
    create_challenge,
    record_login_failure,
    verify_challenge,
)
from app.services.wallet.card_keys import (
    RedeemError,
    check_redeem_rate_limit,
    clear_redeem_rate_limit,
    record_redeem_attempt,
    redeem_card_key,
    require_strong_card_key_salt,
)
from app.services.wallet.db import (
    ensure_user_balance,
    get_wallet,
    init_wallet_db,
    list_ledger,
    list_ledger_page,
)
from app.services.i18n.errors import http_error, service_error_http, value_error_http
from app.services.i18n.locale import LocaleDep
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])
# Mounted at /wallet — card-key credit top-up (no WeChat/Alipay membership).
wallet_router = APIRouter()

# Hardcoded bootstrap admin — no registration / SES required.
_SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAIL
_SUPER_ADMIN_PASSWORD = SUPER_ADMIN_BOOTSTRAP_PASSWORD
_SUPER_ADMIN_ID = SUPER_ADMIN_ID
_SUPER_ADMIN_NAME = "Super Admin"


def _super_admin_test_code() -> str:
    """Local .env SUPER_ADMIN_TEST_CODE via settings (not bare os.environ)."""
    return (getattr(settings, "super_admin_test_code", None) or "").strip()


_AUTH_CODE_KEYS = frozenset(
    {
        "link_invalid",
        "link_expired",
        "code_missing",
        "code_expired",
        "code_locked",
        "code_invalid",
    }
)


def _normalize_email(raw: str, locale: str | None = None) -> str:
    email = (raw or "").strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise http_error(400, "invalid_email", locale)
    return email


def _need_captcha_error(locale: str | None = None) -> HTTPException:
    return http_error(428, "need_captcha", locale)


def _super_admin_session() -> SessionUser:
    try:
        ensure_user_balance(_SUPER_ADMIN_ID, starting_credits=0)
        ensure_super_admin_role()
    except Exception:
        logger.exception("Failed to ensure super-admin wallet / role")
    return SessionUser(
        id=_SUPER_ADMIN_ID,
        email=_SUPER_ADMIN_EMAIL,
        name=_SUPER_ADMIN_NAME,
        avatar=None,
        provider="email",
        role="admin",
        status="active",
    )


def _try_super_admin(email: str, password: str) -> SessionUser | None:
    if email != _SUPER_ADMIN_EMAIL:
        return None
    # Strip so trailing spaces from paste don't fail the check.
    pw = (password or "").strip()
    if not hmac.compare_digest(pw, _SUPER_ADMIN_PASSWORD):
        return None
    return _super_admin_session()


class RedeemIn(BaseModel):
    # v2: XXXXX-XXXXX-XXXXX-XXXXX (23 with dashes)
    code: str = Field(..., min_length=16, max_length=48)




class GoogleAuthIn(BaseModel):
    """GIS ID token (`credential`) or OAuth auth-code (`code`) from redirect/popup."""

    credential: str | None = Field(default=None, min_length=1)
    code: str | None = Field(default=None, min_length=1)
    # Full-page redirect URI; must match authorize request (not postmessage).
    redirectUri: str | None = Field(default=None, min_length=1)


class EmailSendCodeIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    captchaToken: str | None = Field(default=None, max_length=128)


class EmailVerifyCodeIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    code: str = Field(..., min_length=4, max_length=8)
    captchaToken: str | None = Field(default=None, max_length=128)



class EmailLoginIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=6, max_length=128)
    captchaToken: str | None = Field(default=None, max_length=128)



class ChangePasswordIn(BaseModel):
    currentPassword: str = Field(..., min_length=6, max_length=128)
    newPassword: str = Field(..., min_length=6, max_length=128)


class CaptchaVerifyIn(BaseModel):
    captchaId: str = Field(..., min_length=8, max_length=64)
    x: float
    email: str = Field(..., min_length=3, max_length=254)
    trajectory: list[dict[str, Any]] | None = None


def _client_ip(request: Request) -> str | None:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    if request.client:
        return request.client.host
    return None


def _auth_code_error(key: str, locale: str | None) -> HTTPException:
    code = key if key in _AUTH_CODE_KEYS else "request_failed"
    return http_error(400, code, locale)


class ProfileIn(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    bio: str | None = Field(default=None, max_length=2000)
    avatar: str | None = Field(default=None, max_length=2_000_000)


def _user_payload(user: SessionUser) -> dict[str, Any]:
    from app.services.auth.admin import is_admin_user

    role = (getattr(user, "role", None) or "user").strip().lower() or "user"
    if is_admin_user(user):
        role = "admin"
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        # Effective: custom upload, else OAuth/default.
        "avatar": user.avatar,
        "avatarCustom": getattr(user, "avatar_custom", None),
        "defaultAvatar": getattr(user, "default_avatar", None),
        "provider": user.provider,
        "role": role,
        "bio": getattr(user, "bio", None),
    }


@router.get("/config", response_model=AuthConfigOut)
def auth_config() -> AuthConfigOut:
    from app.services.wallet.db import is_wallet_billing_enabled

    return AuthConfigOut(
        googleEnabled=bool((settings.google_client_id or "").strip()),
        googleClientId=(settings.google_client_id or "").strip() or None,
        emailEnabled=ses_configured(),
        billingEnabled=is_wallet_billing_enabled(),
    )



@router.post("/google", response_model=AuthSessionOut)
def auth_google(locale: LocaleDep, body: GoogleAuthIn) -> dict[str, Any]:
    try:
        if body.code:
            user, token = login_with_google_auth_code(
                body.code.strip(),
                redirect_uri=(body.redirectUri or "").strip() or None,
            )
        elif body.credential:
            user, token = login_with_google_credential(body.credential.strip())
        else:
            raise http_error(400, "provide_credential_or_code", locale)
    except RuntimeError as err:
        raise http_error(503, "service_unavailable", locale) from err
    except ValueError as err:
        msg = str(err).strip()
        if msg:
            raise HTTPException(
                status_code=401,
                detail={"code": "auth_failed", "message": msg},
            ) from err
        raise http_error(401, "auth_failed", locale) from err

    return {"user": _user_payload(user), "token": token}


@router.post("/email/send-code")
def email_send_code(body: EmailSendCodeIn, request: Request,
    locale: LocaleDep) -> dict[str, Any]:
    """Send 6-digit email verification code for login."""
    email = _normalize_email(body.email, locale)
    ip = _client_ip(request)

    # Local-only test OTP when SUPER_ADMIN_TEST_CODE is set in .env (gitignored).
    test_code = _super_admin_test_code()
    if email == _SUPER_ADMIN_EMAIL and test_code:
        store_code(email, test_code)
        logger.warning(
            "TEMP admin login: SUPER_ADMIN_TEST_CODE enabled for %s",
            email,
        )
        return {"ok": True, "expiresIn": 300, "mode": "code"}

    if captcha_required(email, ip):
        if not consume_captcha_token(body.captchaToken, email):
            raise _need_captcha_error(locale)

    allowed, retry_after = can_send_code(email)
    if not allowed:
        record_login_failure(email, ip)
        if captcha_required(email, ip) and not body.captchaToken:
            raise _need_captcha_error(locale)
        exc = http_error(
            429,
            "email_send_rate_limited",
            locale,
            seconds=int(retry_after),
            headers={"Retry-After": str(int(retry_after))},
        )
        raise exc

    if not ses_configured():
        raise http_error(503, "email_not_configured", locale)

    code = generate_code()
    store_code(email, code)
    try:
        send_verification_email(to_email=email, code=code)
    except SesError as err:
        logger.exception("Email send failed for %s", email)
        raise http_error(502, "service_unavailable", locale) from err
    return {"ok": True, "expiresIn": 300, "mode": "code"}


class EmailActivateIn(BaseModel):
    id: str = Field(..., min_length=8, max_length=128)


@router.post("/email/activate", response_model=AuthSessionOut)
def email_activate(body: EmailActivateIn, request: Request,
    locale: LocaleDep) -> dict[str, Any]:
    """Consume one-time /activate/{{id}} link → session (email magic-link mails)."""
    ip = _client_ip(request)
    try:
        email = consume_activate_token(body.id)
    except ValueError as err:
        record_login_failure("activate", ip)
        raise _auth_code_error(str(err), locale) from err

    clear_login_failures(email, ip)
    user = ensure_email_user(email=email)
    session = SessionUser(
        id=user.id,
        email=user.email,
        name=user.name,
        avatar=user.avatar,
        provider="email",
        role=getattr(user, "role", None) or "user",
        status=getattr(user, "status", None) or "active",
    )
    session, token = create_session(session)
    return {"user": _user_payload(session), "token": token}


@router.post("/email/verify-code", response_model=AuthSessionOut)
def email_verify_code(body: EmailVerifyCodeIn, request: Request,
    locale: LocaleDep) -> dict[str, Any]:
    """Verify 6-digit email code → session."""
    email = _normalize_email(body.email, locale)
    ip = _client_ip(request)
    code = body.code.strip()

    # Local-only test OTP when SUPER_ADMIN_TEST_CODE is set in .env (gitignored).
    test_code = _super_admin_test_code()
    if (
        email == _SUPER_ADMIN_EMAIL
        and test_code
        and hmac.compare_digest(code, test_code)
    ):
        clear_login_failures(email, ip)
        session, token = create_session(_super_admin_session())
        return {"user": _user_payload(session), "token": token}

    passed_captcha = False
    if captcha_required(email, ip):
        if not consume_captcha_token(body.captchaToken, email):
            raise _need_captcha_error(locale)
        passed_captcha = True

    try:
        ticket = verify_and_issue_ticket(email, code)
    except ValueError as err:
        key = str(err)
        if key in ("code_invalid", "code_locked", "code_expired", "code_missing"):
            record_login_failure(email, ip)
            if passed_captcha:
                raise _auth_code_error(key, locale) from err
            if captcha_required(email, ip):
                raise _need_captcha_error(locale) from err
        raise _auth_code_error(key, locale) from err

    clear_login_failures(email, ip)
    if not consume_ticket(email, ticket):
        raise http_error(400, "ticket_invalid", locale)
    user = ensure_email_user(email=email)
    if email == _SUPER_ADMIN_EMAIL:
        # Persist role=admin + Pro for admin@… (OTP used to leave role=user).
        try:
            ensure_super_admin_role()
        except Exception:
            logger.exception("Failed to ensure super-admin role on OTP login")
        user = ensure_email_user(email=email)
    session = SessionUser(
        id=user.id,
        email=user.email,
        name=user.name if email != _SUPER_ADMIN_EMAIL else (user.name or _SUPER_ADMIN_NAME),
        avatar=user.avatar,
        provider="email",
        role="admin" if email == _SUPER_ADMIN_EMAIL else (getattr(user, "role", None) or "user"),
        status=getattr(user, "status", None) or "active",
    )
    session, token = create_session(session)
    return {"user": _user_payload(session), "token": token}


@router.post("/captcha/create")
def captcha_create() -> dict[str, Any]:
    return create_challenge()


@router.post("/captcha/verify")
def captcha_verify(locale: LocaleDep, body: CaptchaVerifyIn) -> dict[str, Any]:
    email = _normalize_email(body.email, locale)
    try:
        return verify_challenge(
            body.captchaId,
            body.x,
            email,
            trajectory=body.trajectory,
        )
    except ValueError as err:
        raise value_error_http(err, locale) from err


@router.post("/email/login", response_model=AuthSessionOut)
def email_login(body: EmailLoginIn, request: Request,
    locale: LocaleDep) -> dict[str, Any]:
    """Super-admin password bootstrap only. Public users sign in via /email/verify-code."""
    email = _normalize_email(body.email, locale)
    ip = _client_ip(request)

    passed_captcha = False
    if captcha_required(email, ip):
        if not consume_captcha_token(body.captchaToken, email):
            raise _need_captcha_error(locale)
        passed_captcha = True

    admin = _try_super_admin(email, body.password)
    if admin:
        clear_login_failures(email, ip)
        session, token = create_session(admin)
        return {"user": _user_payload(session), "token": token}

    record_login_failure(email, ip)
    if passed_captcha:
        raise http_error(401, "use_email_verification_code", locale)
    if captcha_required(email, ip):
        raise _need_captcha_error(locale)
    raise http_error(401, "use_email_verification_code", locale)



@router.get("/me", response_model=AuthMeOut)
def auth_me(current_user: CurrentUser) -> dict[str, Any]:
    return {
        "user": _user_payload(current_user),
    }


@router.patch("/profile")
def auth_patch_profile(
    locale: LocaleDep,
    current_user: CurrentUser,
    body: ProfileIn,
) -> dict[str, Any]:
    updated = update_profile(
        current_user.id,
        name=body.name,
        bio=body.bio,
        avatar=body.avatar,
    )
    if not updated:
        raise http_error(404, "user_not_found", locale)
    return {
        "user": {
            "id": updated.id,
            "email": updated.email,
            "name": updated.name,
            "avatar": updated.avatar,
            "bio": updated.bio,
            "provider": updated.provider,
        }
    }


@router.post("/logout", response_model=Message)
def auth_logout(session: SessionDep, token: TokenDep) -> Message:
    revoke_session(token, db=session)
    return Message(message="Logged out")

@wallet_router.get("/plans")
def wallet_plans() -> dict[str, Any]:
    """Public membership list prices + monthly credit grants (no margin)."""
    from app.services.wallet.billing import public_plan_catalog

    return {"plans": public_plan_catalog()}


@wallet_router.get("/purchase-info")
def purchase_info() -> dict[str, Any]:
    return {
        "xianyuUrl": (settings.xianyu_shop_url or "").strip() or None,
        "authorContact": (settings.author_contact or "").strip() or None,
        "xianyuQrUrl": (settings.xianyu_qr_url or "").strip() or None,
        "wechatQrUrl": (settings.wechat_qr_url or "").strip() or None,
        "hint": "No WeChat/Alipay. Buy card keys on Xianyu or contact the author.",
    }


def _wallet_plan_fields(snap: dict[str, Any]) -> dict[str, Any]:
    return {
        "planId": snap.get("planId") or "free",
        "planExpiresAt": snap.get("planExpiresAt"),
        "planLocked": bool(snap.get("planLocked")),
    }


@wallet_router.get("")
def wallet_me(current_user: CurrentUser) -> dict[str, Any]:
    init_wallet_db()
    snap = get_wallet(current_user.id)
    credits = int(snap.get("credits") or 0)
    return {
        "credits": credits,
        **_wallet_plan_fields(snap),
        "ledger": list_ledger(current_user.id),
    }


@wallet_router.get("/ledger")
def wallet_ledger(
    current_user: CurrentUser,
    page: int = 1,
    pageSize: int = 15,
    kind: str = "all",
) -> dict[str, Any]:
    """
    Paginated billing ledger.
    kind=all|redeem|spend — tab filter from Usage & billing dialog.
    """
    init_wallet_db()
    snap = get_wallet(current_user.id)
    credits = int(snap.get("credits") or 0)
    return {
        "credits": credits,
        **_wallet_plan_fields(snap),
        **list_ledger_page(current_user.id, page=page, page_size=pageSize, kind=kind),
    }


_REDEEM_ERROR_MAP: dict[str, tuple[int, str]] = {
    "misconfigured": (503, "card_key_misconfigured"),
    "invalid_format": (400, "card_key_invalid_format"),
    "not_found": (404, "card_key_not_found"),
    "already_used": (400, "card_key_already_used"),
    "revoked": (400, "card_key_revoked"),
    "expired": (400, "card_key_expired"),
    "invalid_kind": (400, "card_key_invalid_kind"),
    "invalid_plan": (400, "card_key_invalid_plan"),
    "plan_locked": (400, "card_key_plan_locked"),
    "invalid_amount": (400, "card_key_invalid_amount"),
    "rate_limited": (429, "redeem_rate_limited"),
}


def _redeem_http(err: RedeemError, locale: str | None):
    """Map RedeemError → localized HTTP detail."""
    import re

    status, code = _REDEEM_ERROR_MAP.get(err.code, (400, "request_failed"))
    if code == "redeem_rate_limited":
        m = re.search(r"(\d+)\s*s", str(err.message or ""), re.I)
        seconds = int(m.group(1)) if m else 60
        return http_error(status, code, locale, seconds=seconds)
    return service_error_http(code, locale, status=status, message=err.message)


@wallet_router.post("/redeem")
def wallet_redeem(
    current_user: CurrentUser,
    body: RedeemIn,
    request: Request,
    locale: LocaleDep,
) -> dict[str, Any]:
    try:
        require_strong_card_key_salt()
    except ValueError as err:
        raise value_error_http(err, locale, status=503) from err
    ip = _client_ip(request)
    try:
        check_redeem_rate_limit(user_id=current_user.id, ip=ip)
    except RedeemError as err:
        raise _redeem_http(err, locale) from err
    record_redeem_attempt(user_id=current_user.id, ip=ip)
    try:
        result = redeem_card_key(current_user.id, body.code)
    except RedeemError as err:
        raise _redeem_http(err, locale) from err
    clear_redeem_rate_limit(user_id=current_user.id, ip=ip)
    snap = get_wallet(current_user.id)
    credits = int(snap.get("credits") or 0)
    added = int(result.get("creditsAdded") or 0)
    return {
        "kind": result.get("kind") or "credit",
        "creditsAdded": added,
        "credits": credits,
        **_wallet_plan_fields(snap),
        "ledger": list_ledger(current_user.id),
    }


