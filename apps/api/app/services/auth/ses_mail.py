"""Send registration verification emails (SES)."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.config import Settings

logger = logging.getLogger(__name__)

SERVICE = "ses"
# Domestic SES uses a global endpoint; region goes in X-TC-Region.
HOST = "ses.tencentcloudapi.com"
ALGORITHM = "TC3-HMAC-SHA256"


class SesError(RuntimeError):
    pass


def _settings() -> Settings:
    """Fresh settings so .env edits apply without a full process restart."""
    return Settings()


def ses_configured() -> bool:
    s = _settings()
    return bool(
        s.tencent_secret_id.strip()
        and s.tencent_secret_key.strip()
        and s.ses_from_email.strip()
    )


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _tc3_authorization(
    *,
    secret_id: str,
    secret_key: str,
    service: str,
    host: str,
    action: str,
    payload: str,
    timestamp: int,
    content_type: str = "application/json; charset=utf-8",
) -> tuple[str, str]:
    date = datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%Y-%m-%d")
    canonical_headers = (
        f"content-type:{content_type}\nhost:{host}\nx-tc-action:{action.lower()}\n"
    )
    signed_headers = "content-type;host;x-tc-action"
    hashed_request_payload = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    canonical_request = (
        "POST\n/\n\n"
        + canonical_headers
        + "\n"
        + signed_headers
        + "\n"
        + hashed_request_payload
    )
    credential_scope = f"{date}/{service}/tc3_request"
    string_to_sign = (
        f"{ALGORITHM}\n{timestamp}\n{credential_scope}\n"
        + hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
    )
    secret_date = _sign(("TC3" + secret_key).encode("utf-8"), date)
    secret_service = _sign(secret_date, service)
    secret_signing = _sign(secret_service, "tc3_request")
    signature = hmac.new(
        secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    authorization = (
        f"{ALGORITHM} Credential={secret_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    return authorization, content_type


def _ses_request(action: str, params: dict[str, Any]) -> dict[str, Any]:
    s = _settings()
    if not (
        s.tencent_secret_id.strip()
        and s.tencent_secret_key.strip()
        and s.ses_from_email.strip()
    ):
        raise SesError("Email sending is not configured")

    region = (s.ses_region or "ap-hongkong").strip()
    host = HOST
    url = f"https://{host}"
    payload = json.dumps(params, ensure_ascii=False, separators=(",", ":"))
    timestamp = int(time.time())
    authorization, content_type = _tc3_authorization(
        secret_id=s.tencent_secret_id.strip(),
        secret_key=s.tencent_secret_key.strip(),
        service=SERVICE,
        host=host,
        action=action,
        payload=payload,
        timestamp=timestamp,
    )
    headers = {
        "Authorization": authorization,
        "Content-Type": content_type,
        "Host": host,
        "X-TC-Action": action,
        "X-TC-Timestamp": str(timestamp),
        "X-TC-Version": "2020-10-02",
        "X-TC-Region": region,
    }
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(url, headers=headers, content=payload.encode("utf-8"))
    try:
        data = resp.json()
    except Exception as exc:
        raise SesError(
            f"Email service HTTP {resp.status_code}: invalid JSON response"
        ) from exc

    response = data.get("Response") or {}
    error = response.get("Error")
    if error:
        code = error.get("Code", "Unknown")
        msg = error.get("Message", "")
        raise SesError(f"Email send failed ({code}): {msg}")
    if resp.status_code >= 400:
        raise SesError(f"Email service HTTP {resp.status_code}")
    return response


def send_verification_email(*, to_email: str, code: str) -> str:
    """Send 6-digit login code via SES template {{username}} / {{id}} (id = code)."""
    s = _settings()
    from_email = s.ses_from_email.strip()
    from_name = (s.ses_from_name or "recombyn").strip()
    username = (to_email.split("@", 1)[0] or "there").strip()
    subject = f"[{from_name}] 登录验证码"
    params: dict[str, Any] = {
        "FromEmailAddress": (
            f"{from_name} <{from_email}>" if from_name else from_email
        ),
        "Destination": [to_email.strip().lower()],
        "Subject": subject,
        "TriggerType": 1,
    }

    template_id = int(s.ses_template_id or 0)
    if template_id <= 0:
        raise SesError(
            "SES_TEMPLATE_ID is required"
        )

    # Template 210471 vars: {{username}}, {{id}} — for OTP we pass the 6-digit code as id.
    params["Template"] = {
        "TemplateID": template_id,
        "TemplateData": json.dumps(
            {
                "username": username,
                "id": code,
            },
            ensure_ascii=False,
        ),
    }

    result = _ses_request("SendEmail", params)
    message_id = str(result.get("MessageId") or "")
    logger.info(
        "SendEmail login-code ok to=%s templateId=%s messageId=%s",
        to_email,
        template_id,
        message_id,
    )
    return message_id


def public_app_origin() -> str:
    """Web origin for deep links (no trailing slash)."""
    s = _settings()
    explicit = (s.public_app_base_url or "").strip().rstrip("/")
    if explicit:
        return explicit
    activate = (s.ses_activate_base_url or "").strip()
    if "/activate" in activate:
        return activate.split("/activate", 1)[0].rstrip("/") or "https://recombyn.com"
    if activate.startswith("http"):
        # origin only
        try:
            from urllib.parse import urlparse

            p = urlparse(activate)
            if p.scheme and p.netloc:
                return f"{p.scheme}://{p.netloc}"
        except Exception:
            pass
    return "https://recombyn.com"


def send_org_invite_email(
    *,
    to_email: str,
    org_name: str,
    inviter_name: str,
    accept_path: str = "/account?tab=org",
) -> str:
    """Notify invitee about a pending org invite. Prefers SES Simple; Template fallback."""
    s = _settings()
    if not ses_configured():
        raise SesError("Email sending is not configured")

    from_email = s.ses_from_email.strip()
    from_name = (s.ses_from_name or "recombyn").strip()
    org = (org_name or "a team").strip()[:120]
    inviter = (inviter_name or "A teammate").strip()[:80]
    username = (to_email.split("@", 1)[0] or "there").strip()
    accept_url = f"{public_app_origin()}{accept_path if accept_path.startswith('/') else '/' + accept_path}"
    subject = f"[{from_name}] Invitation to join {org}"
    text_body = (
        f"Hi {username},\n\n"
        f"{inviter} invited you to join “{org}” on Recombyn.\n"
        f"Sign in and open Account → Organization to accept:\n"
        f"{accept_url}\n\n"
        f"— {from_name}\n"
    )
    html_body = (
        f"<p>Hi {username},</p>"
        f"<p><strong>{inviter}</strong> invited you to join "
        f"<strong>{org}</strong> on Recombyn.</p>"
        f"<p><a href=\"{accept_url}\">Open Account → Organization</a> to accept.</p>"
        f"<p style=\"color:#666;font-size:12px\">{accept_url}</p>"
    )

    params: dict[str, Any] = {
        "FromEmailAddress": (
            f"{from_name} <{from_email}>" if from_name else from_email
        ),
        "Destination": [to_email.strip().lower()],
        "Subject": subject,
        "TriggerType": 1,
        "Simple": {
            "Html": html_body,
            "Text": text_body,
        },
    }

    try:
        result = _ses_request("SendEmail", params)
    except SesError as exc:
        # Some tenants only allow Template sends — reuse login template vars.
        logger.warning(
            "org invite Simple send failed (%s); trying template fallback", exc
        )
        template_id = int(s.ses_template_id or 0)
        if template_id <= 0:
            raise
        params.pop("Simple", None)
        params["Template"] = {
            "TemplateID": template_id,
            "TemplateData": json.dumps(
                {
                    "username": username,
                    # Template {{id}} often becomes the CTA body / path segment.
                    "id": f"org-invite:{org}|{accept_url}",
                },
                ensure_ascii=False,
            ),
        }
        result = _ses_request("SendEmail", params)

    message_id = str(result.get("MessageId") or "")
    logger.info(
        "SendEmail org-invite ok to=%s org=%s messageId=%s",
        to_email,
        org,
        message_id,
    )
    return message_id
