"""Upload magic sniff + AV hook (ADR 0008)."""

from __future__ import annotations

import pytest


_PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
    b"\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_sniff_png_and_reject_pe():
    from app.services import uploads as mod

    assert mod._sniff_media(_PNG) == ("png", "image/png")
    with pytest.raises(ValueError, match="executable"):
        mod._sniff_media(b"MZ\x90\x00" + b"\x00" * 60)


def test_reconcile_prefers_jpeg_magic_over_png_name():
    from app.services import uploads as mod

    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 20
    ext, mime = mod._reconcile_claimed_and_magic(
        jpeg, claimed_ext="png", claimed_mime="image/png"
    )
    assert ext == "jpg"
    assert mime == "image/jpeg"


def test_reconcile_rejects_family_mismatch(monkeypatch: pytest.MonkeyPatch):
    from app.services import uploads as mod

    monkeypatch.setattr(mod.settings, "upload_require_magic_match", True)
    with pytest.raises(ValueError, match="mismatch"):
        mod._reconcile_claimed_and_magic(
            _PNG, claimed_ext="mp3", claimed_mime="audio/mpeg"
        )


def test_svg_script_rejected():
    from app.services import uploads as mod

    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    with pytest.raises(ValueError, match="SVG"):
        mod._reconcile_claimed_and_magic(
            svg, claimed_ext="svg", claimed_mime="image/svg+xml"
        )


def test_upload_user_file_uses_sniffed_ext(monkeypatch: pytest.MonkeyPatch):
    from app.services import uploads as mod

    stored: dict[str, object] = {}

    class _Storage:
        def enabled_remote(self) -> bool:
            return False

        def url_for(self, key: str) -> str:
            return f"s3://{key}"

    monkeypatch.setattr(mod, "put_bytes", lambda key, data, content_type=None: stored.setdefault("key", key))
    monkeypatch.setattr(mod, "get_storage", lambda: _Storage())
    monkeypatch.setattr(mod, "_probe_image_size", lambda *_a, **_k: (1, 1))
    monkeypatch.setattr(mod.settings, "upload_av_hook_enabled", False)

    out = mod.upload_user_file(
        "u1",
        data=_PNG,
        filename="photo.jpg",
        content_type="image/jpeg",
    )
    assert out["mime"] == "image/png"
    assert str(stored["key"]).endswith(".png")


def test_av_hook_runs_when_enabled(monkeypatch: pytest.MonkeyPatch):
    from app.services import uploads as mod

    calls: list[list[str]] = []

    class _Completed:
        returncode = 0
        stderr = b""

    def _run(argv, **_k):
        calls.append(list(argv))
        return _Completed()

    monkeypatch.setattr(mod.settings, "upload_av_hook_enabled", True)
    monkeypatch.setattr(mod.settings, "upload_av_command", "scanner --foo")
    monkeypatch.setattr(mod.subprocess, "run", _run)
    mod._run_av_hook(_PNG, filename="a.png")
    assert calls and calls[0][0] == "scanner"
    assert calls[0][1] == "--foo"
    assert calls[0][-1].endswith("a.png")
