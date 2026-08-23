"""Google OAuth login — ID token verify, or auth-code exchange (redirect / popup)."""

from __future__ import annotations

import time
from urllib.parse import urlparse

import httpx
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from app.core.config import settings
from app.services.auth import SessionUser, create_session

_VALID_ISSUERS = frozenset({"accounts.google.com", "https://accounts.google.com"})
# GIS popup code client uses this redirect_uri (not a real browser redirect).
_POPUP_REDIRECT_URI = "postmessage"
_REDIRECT_PATH = "/login/google/callback"
_TOKEN_URL = "https://oauth2.googleapis.com/token"


def _session_from_id_token(credential: str) -> tuple[SessionUser, str]:
    client_id = (settings.google_client_id or "").strip()
    if not client_id:
        raise RuntimeError("Google OAuth is not configured (GOOGLE_CLIENT_ID)")

    try:
        payload = id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            audience=client_id,
        )
    except Exception as err:
        raise ValueError(f"Invalid Google credential: {err}") from err

    iss = payload.get("iss")
    if iss not in _VALID_ISSUERS:
        raise ValueError("Invalid Google credential: wrong issuer")

    sub = payload.get("sub")
    email = payload.get("email")
    if not sub or not email:
        raise ValueError("Invalid Google credential: missing sub or email")

    if payload.get("email_verified") is not True:
        raise ValueError("Google account email is not verified")

    user = SessionUser(
        id=f"google:{sub}",
        email=str(email),
        name=str(payload.get("name") or email.split("@")[0]),
        avatar=str(payload.get("picture") or "") or None,
        provider="google",
    )
    # create_session returns DB profile (keeps customized name/avatar on re-login).
    return create_session(user)


def login_with_google_credential(credential: str) -> tuple[SessionUser, str]:
    """Verify Google JWT (GIS button / One Tap) and create a session."""
    return _session_from_id_token(credential)


def _resolve_redirect_uri(redirect_uri: str | None) -> str:
    """Use full-page callback URI when provided; otherwise GIS popup postmessage."""
    uri = (redirect_uri or "").strip()
    if not uri:
        return _POPUP_REDIRECT_URI
    parsed = urlparse(uri)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Invalid redirect_uri")
    if not parsed.path.endswith(_REDIRECT_PATH):
        raise ValueError("Invalid redirect_uri")
    return uri


def _google_httpx_client() -> httpx.Client:
    timeout = float(settings.google_oauth_timeout_sec or 30.0)
    proxy = (settings.google_oauth_http_proxy or "").strip() or None
    return httpx.Client(timeout=timeout, proxy=proxy)


def _exchange_timeout_hint(err: BaseException) -> str:
    proxy = (settings.google_oauth_http_proxy or "").strip()
    base = (
        "Google token exchange timed out — this API host cannot reach "
        "oauth2.googleapis.com within the deadline"
    )
    if proxy:
        return f"{base} (proxy={proxy}). Check the proxy and try again."
    return (
        f"{base}. If the server is in a restricted network, set "
        "GOOGLE_OAUTH_HTTP_PROXY (e.g. http://127.0.0.1:7890) and restart the API."
    )


def _post_google_token(data: dict[str, str]) -> httpx.Response:
    """POST to Google's token endpoint; one retry on transient timeout/connect errors."""
    last_err: BaseException | None = None
    for attempt in range(2):
        try:
            with _google_httpx_client() as client:
                return client.post(_TOKEN_URL, data=data)
        except (httpx.TimeoutException, httpx.NetworkError, httpx.TransportError) as err:
            last_err = err
            if attempt == 0:
                time.sleep(0.4)
                continue
            if isinstance(err, httpx.TimeoutException):
                raise ValueError(_exchange_timeout_hint(err)) from err
            raise ValueError(f"Google token exchange failed: {err}") from err
    assert last_err is not None
    raise ValueError(f"Google token exchange failed: {last_err}") from last_err


def login_with_google_auth_code(
    code: str,
    redirect_uri: str | None = None,
) -> tuple[SessionUser, str]:
    """
    Exchange an OAuth authorization code for tokens, then verify id_token.

    Full-page redirect: pass the same redirect_uri used in the authorize URL
    (e.g. http://localhost:3000/login/google/callback).
    Legacy popup GIS: omit redirect_uri (uses postmessage).
    Requires GOOGLE_CLIENT_SECRET on the API.
    """
    client_id = (settings.google_client_id or "").strip()
    client_secret = (settings.google_client_secret or "").strip()
    if not client_id:
        raise RuntimeError("Google OAuth is not configured (GOOGLE_CLIENT_ID)")
    if not client_secret:
        raise RuntimeError("Google OAuth is not configured (GOOGLE_CLIENT_SECRET)")

    resolved_redirect = _resolve_redirect_uri(redirect_uri)

    try:
        token_res = _post_google_token(
            {
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": resolved_redirect,
                "grant_type": "authorization_code",
            }
        )
    except ValueError:
        raise
    except Exception as err:
        raise ValueError(f"Google token exchange failed: {err}") from err

    if token_res.status_code >= 400:
        detail = token_res.text
        try:
            detail = token_res.json().get("error_description") or token_res.json().get("error") or detail
        except Exception:
            pass
        raise ValueError(f"Google token exchange failed: {detail}")

    data = token_res.json()
    id_tok = data.get("id_token")
    if not id_tok:
        raise ValueError("Google token exchange did not return id_token (need openid scope)")

    return _session_from_id_token(str(id_tok))
