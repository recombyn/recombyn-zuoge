"""Self-hosted slider captcha — challenge + fail-gate for login / register.

Not shown every time: only after repeated failures (email / IP), e.g. wrong
password, wrong email verification code, or send-code abuse.
"""

from __future__ import annotations

import base64
import io
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Any

from PIL import Image, ImageDraw, ImageFilter

# --- tuning ---
_FAIL_WINDOW_SEC = 10 * 60
_FAIL_THRESHOLD = 3
_CHALLENGE_TTL_SEC = 5 * 60
_TOKEN_TTL_SEC = 3 * 60
_BG_W, _BG_H = 320, 160
# Bounding box for all piece shapes (body + tabs).
_PIECE_W = 56
_PIECE_H = 56
_BODY = 40
_TAB_R = 9
_TOLERANCE_PX = 8
_SHAPE_KINDS = ("jigsaw", "triangle", "circle", "diamond", "arrow")


@dataclass
class _Challenge:
    target_x: int
    y: int
    expires: float


@dataclass
class _FailBucket:
    count: int = 0
    first_at: float = 0.0


@dataclass
class _Token:
    email: str
    expires: float


_lock = threading.Lock()
_challenges: dict[str, _Challenge] = {}
_tokens: dict[str, _Token] = {}
_fails: dict[str, _FailBucket] = {}


def _now() -> float:
    return time.time()


def _purge(now: float | None = None) -> None:
    t = now if now is not None else _now()
    dead_c = [k for k, v in _challenges.items() if v.expires < t]
    for k in dead_c:
        _challenges.pop(k, None)
    dead_t = [k for k, v in _tokens.items() if v.expires < t]
    for k in dead_t:
        _tokens.pop(k, None)
    dead_f = [
        k
        for k, v in _fails.items()
        if v.first_at and t - v.first_at > _FAIL_WINDOW_SEC
    ]
    for k in dead_f:
        _fails.pop(k, None)


def _fail_key(email: str, ip: str | None) -> list[str]:
    keys = [f"email:{email.strip().lower()}"]
    if ip:
        keys.append(f"ip:{ip.strip()}")
    return keys


def record_login_failure(email: str, ip: str | None = None) -> None:
    now = _now()
    with _lock:
        _purge(now)
        for key in _fail_key(email, ip):
            bucket = _fails.get(key)
            if not bucket or now - bucket.first_at > _FAIL_WINDOW_SEC:
                _fails[key] = _FailBucket(count=1, first_at=now)
            else:
                bucket.count += 1


def clear_login_failures(email: str, ip: str | None = None) -> None:
    with _lock:
        for key in _fail_key(email, ip):
            _fails.pop(key, None)


def captcha_required(email: str, ip: str | None = None) -> bool:
    now = _now()
    with _lock:
        _purge(now)
        for key in _fail_key(email, ip):
            bucket = _fails.get(key)
            if (
                bucket
                and now - bucket.first_at <= _FAIL_WINDOW_SEC
                and bucket.count >= _FAIL_THRESHOLD
            ):
                return True
    return False


def consume_captcha_token(token: str | None, email: str) -> bool:
    if not token:
        return False
    now = _now()
    with _lock:
        _purge(now)
        row = _tokens.pop(token.strip(), None)
        if not row or row.expires < now:
            return False
        return row.email == email.strip().lower()


def _rand_color(rng: secrets.SystemRandom, low: int = 40, high: int = 200) -> tuple[int, int, int]:
    return (rng.randint(low, high), rng.randint(low, high), rng.randint(low, high))


def _mask_jigsaw() -> Image.Image:
    """Square + top tab + right tab (≥2 protrusions)."""
    mask = Image.new("L", (_PIECE_W, _PIECE_H), 0)
    d = ImageDraw.Draw(mask)
    ox = _TAB_R
    oy = _TAB_R
    d.rectangle([ox, oy, ox + _BODY - 1, oy + _BODY - 1], fill=255)
    # Top tab
    d.ellipse(
        [ox + _BODY // 2 - _TAB_R, oy - _TAB_R, ox + _BODY // 2 + _TAB_R, oy + _TAB_R],
        fill=255,
    )
    # Right tab
    d.ellipse(
        [
            ox + _BODY - _TAB_R,
            oy + _BODY // 2 - _TAB_R,
            ox + _BODY + _TAB_R,
            oy + _BODY // 2 + _TAB_R,
        ],
        fill=255,
    )
    return mask.filter(ImageFilter.SMOOTH)


def _mask_triangle() -> Image.Image:
    mask = Image.new("L", (_PIECE_W, _PIECE_H), 0)
    d = ImageDraw.Draw(mask)
    pad = 4
    d.polygon(
        [
            (_PIECE_W // 2, pad),
            (_PIECE_W - pad, _PIECE_H - pad),
            (pad, _PIECE_H - pad),
        ],
        fill=255,
    )
    return mask.filter(ImageFilter.SMOOTH)


def _mask_circle() -> Image.Image:
    mask = Image.new("L", (_PIECE_W, _PIECE_H), 0)
    d = ImageDraw.Draw(mask)
    pad = 3
    d.ellipse([pad, pad, _PIECE_W - pad - 1, _PIECE_H - pad - 1], fill=255)
    return mask.filter(ImageFilter.SMOOTH)


def _mask_diamond() -> Image.Image:
    mask = Image.new("L", (_PIECE_W, _PIECE_H), 0)
    d = ImageDraw.Draw(mask)
    cx, cy = _PIECE_W // 2, _PIECE_H // 2
    rx, ry = _PIECE_W // 2 - 3, _PIECE_H // 2 - 3
    d.polygon([(cx, cy - ry), (cx + rx, cy), (cx, cy + ry), (cx - rx, cy)], fill=255)
    return mask.filter(ImageFilter.SMOOTH)


def _mask_arrow() -> Image.Image:
    """Chevron / arrow pointing right."""
    mask = Image.new("L", (_PIECE_W, _PIECE_H), 0)
    d = ImageDraw.Draw(mask)
    d.polygon(
        [
            (6, 8),
            (30, 8),
            (48, _PIECE_H // 2),
            (30, _PIECE_H - 8),
            (6, _PIECE_H - 8),
            (18, _PIECE_H // 2),
        ],
        fill=255,
    )
    return mask.filter(ImageFilter.SMOOTH)


def _puzzle_mask(kind: str) -> Image.Image:
    if kind == "triangle":
        return _mask_triangle()
    if kind == "circle":
        return _mask_circle()
    if kind == "diamond":
        return _mask_diamond()
    if kind == "arrow":
        return _mask_arrow()
    return _mask_jigsaw()


def _edge_ring(mask: Image.Image) -> Image.Image:
    """White rim around mask silhouette (fast, no per-pixel Python loops)."""
    dilated = mask.filter(ImageFilter.MaxFilter(3))
    # rim = dilated - mask
    rim = Image.new("L", mask.size, 0)
    md = mask.load()
    dd = dilated.load()
    rd = rim.load()
    w, h = mask.size
    for y in range(h):
        for x in range(w):
            if dd[x, y] > 128 and md[x, y] < 80:
                rd[x, y] = 210
    return rim


def _paint_hole(bg_rgba: Image.Image, mask: Image.Image, x: int, y: int) -> None:
    """Classic 挖空: translucent dark gap + light rim (not a solid black blob)."""
    # Soft dark fill — background pattern still faintly visible → reads as a hole.
    dark = Image.new("RGBA", (_PIECE_W, _PIECE_H), (0, 0, 0, 0))
    fill = Image.new("RGBA", (_PIECE_W, _PIECE_H), (15, 18, 24, 155))
    dark.paste(fill, (0, 0), mask)
    bg_rgba.alpha_composite(dark, (x, y))
    # Inner shade (slightly stronger center-left feel via second pass at lower alpha).
    shade = Image.new("RGBA", (_PIECE_W, _PIECE_H), (0, 0, 0, 0))
    shade_fill = Image.new("RGBA", (_PIECE_W, _PIECE_H), (0, 0, 0, 70))
    shade.paste(shade_fill, (0, 0), mask)
    bg_rgba.alpha_composite(shade, (x, y))
    # Light rim so the cut silhouette is obvious.
    rim = Image.new("RGBA", (_PIECE_W, _PIECE_H), (255, 255, 255, 0))
    rim.putalpha(_edge_ring(mask))
    bg_rgba.alpha_composite(rim, (x, y))


def _make_images(target_x: int, y: int, shape: str) -> tuple[str, str]:
    """One bg + one puzzle piece — same shape hole as rc-slider-captcha style."""
    rng = secrets.SystemRandom()
    bg = Image.new("RGB", (_BG_W, _BG_H), _rand_color(rng, 170, 225))
    draw = ImageDraw.Draw(bg)
    for _ in range(22):
        x0 = rng.randint(-30, _BG_W)
        y0 = rng.randint(-30, _BG_H)
        x1 = x0 + rng.randint(40, 140)
        y1 = y0 + rng.randint(30, 100)
        draw.ellipse([x0, y0, x1, y1], fill=_rand_color(rng, 50, 210))
    for _ in range(28):
        x0 = rng.randint(0, _BG_W - 20)
        y0 = rng.randint(0, _BG_H - 20)
        x1 = x0 + rng.randint(16, 70)
        y1 = y0 + rng.randint(16, 50)
        draw.rounded_rectangle(
            [x0, y0, x1, y1],
            radius=rng.randint(4, 14),
            fill=_rand_color(rng, 70, 200),
        )
    for _ in range(50):
        x0 = rng.randint(0, _BG_W)
        y0 = rng.randint(0, _BG_H)
        draw.line(
            [x0, y0, x0 + rng.randint(-50, 50), y0 + rng.randint(-50, 50)],
            fill=_rand_color(rng, 90, 190),
            width=1,
        )

    mask = _puzzle_mask(shape)
    # Cut colorful piece FROM the hole location (before digging).
    region = bg.crop((target_x, y, target_x + _PIECE_W, y + _PIECE_H)).convert("RGBA")
    piece = Image.new("RGBA", (_PIECE_W, _PIECE_H), (0, 0, 0, 0))
    piece.paste(region, (0, 0))
    piece.putalpha(mask)

    bg_rgba = bg.convert("RGBA")
    _paint_hole(bg_rgba, mask, target_x, y)

    # Piece rim + slight lift shadow baked into alpha edge.
    rim = Image.new("RGBA", (_PIECE_W, _PIECE_H), (255, 255, 255, 0))
    rim.putalpha(_edge_ring(mask))
    piece = Image.alpha_composite(piece, rim)

    def to_b64(img: Image.Image) -> str:
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        return base64.b64encode(buf.getvalue()).decode("ascii")

    # Keep piece as PNG with alpha (data URL).
    return to_b64(bg_rgba.convert("RGB")), to_b64(piece)


def create_challenge() -> dict[str, Any]:
    rng = secrets.SystemRandom()
    shape = rng.choice(_SHAPE_KINDS)
    y = rng.randint(12, _BG_H - _PIECE_H - 8)
    # Hole sits on the right half so the piece starts clear on the left (classic UX).
    target_x = rng.randint(_PIECE_W + 40, _BG_W - _PIECE_W - 8)

    captcha_id = secrets.token_urlsafe(18)
    bg_b64, piece_b64 = _make_images(target_x, y, shape)
    now = _now()
    with _lock:
        _purge(now)
        _challenges[captcha_id] = _Challenge(
            target_x=target_x,
            y=y,
            expires=now + _CHALLENGE_TTL_SEC,
        )
    return {
        "captchaId": captcha_id,
        "bg": f"data:image/png;base64,{bg_b64}",
        "piece": f"data:image/png;base64,{piece_b64}",
        "pieceY": y,
        "bgWidth": _BG_W,
        "bgHeight": _BG_H,
        "pieceSize": _PIECE_W,
        "pieceWidth": _PIECE_W,
        "pieceHeight": _PIECE_H,
        "shape": shape,
        "expiresIn": _CHALLENGE_TTL_SEC,
    }


def _beat_percent(_trajectory: list[dict[str, Any]] | None = None) -> int:
    """Display percentile after success — always feel fast (98–99%)."""
    return 98 + secrets.randbelow(2)


def verify_challenge(
    captcha_id: str,
    x: float,
    email: str,
    trajectory: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Validate slide; return one-time captcha_token + beatPercent."""
    now = _now()
    with _lock:
        _purge(now)
        ch = _challenges.pop((captcha_id or "").strip(), None)
        if not ch or ch.expires < now:
            raise ValueError("Captcha expired — refresh and try again")

        if abs(float(x) - ch.target_x) > _TOLERANCE_PX:
            raise ValueError("Captcha failed — try again")

        # Lightweight bot heuristic (optional trajectory).
        if trajectory and len(trajectory) >= 2:
            try:
                t0 = float(trajectory[0].get("t", 0))
                t1 = float(trajectory[-1].get("t", 0))
                if t1 - t0 < 120:
                    raise ValueError("Captcha failed — try again")
            except (TypeError, ValueError) as err:
                if "Captcha failed" in str(err):
                    raise
                # ignore malformed trajectory points

        token = secrets.token_urlsafe(24)
        _tokens[token] = _Token(
            email=email.strip().lower(),
            expires=now + _TOKEN_TTL_SEC,
        )
        return {
            "captchaToken": token,
            "beatPercent": _beat_percent(trajectory),
            "expiresIn": _TOKEN_TTL_SEC,
        }
