"""Object-storage put failures must surface as clear RuntimeError messages."""

from __future__ import annotations

import pytest

from app.services.storage import _storage_put_error_message, put_bytes


def test_arrears_message_is_explicit() -> None:
    msg = _storage_put_error_message(
        Exception(
            "An error occurred (UnavailableForLegalReasons) when calling the "
            "PutObject operation: Due to your account is arrears, it is "
            "unavailable until you recharge."
        )
    )
    assert "欠费" in msg
    assert "对象存储" in msg


def test_put_bytes_wraps_backend_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    class Boom:
        def put_bytes(self, *args, **kwargs):  # noqa: ANN002, ANN003
            raise Exception(
                "An error occurred (UnavailableForLegalReasons) when calling "
                "the PutObject operation: Due to your account is arrears"
            )

        def enabled_remote(self) -> bool:
            return True

    monkeypatch.setattr("app.services.storage.get_storage", lambda: Boom())
    with pytest.raises(RuntimeError, match="欠费"):
        put_bytes("assets/x.bin", b"hi", content_type="application/octet-stream")
