"""OpenRouter path normalization for OpenAI SDK clients."""

from __future__ import annotations

from app.services.llm import (
    _message_from_http_body,
    _normalize_openrouter_rel_path,
    _short_openai_sdk_error,
)


def test_normalize_strips_api_v1_prefix():
    assert _normalize_openrouter_rel_path("/api/v1/videos/job-abc123") == "/videos/job-abc123"


def test_normalize_absolute_polling_url():
    assert (
        _normalize_openrouter_rel_path("https://openrouter.ai/api/v1/videos/job-abc123")
        == "/videos/job-abc123"
    )


def test_normalize_keeps_videos_path():
    assert _normalize_openrouter_rel_path("/videos/job-abc123") == "/videos/job-abc123"


def test_normalize_bare_job_id():
    assert _normalize_openrouter_rel_path("job-abc123") == "/job-abc123"


def test_message_from_html_body_returns_none():
    html = "<!DOCTYPE html><html><title>Not Found | OpenRouter</title></html>"
    assert _message_from_http_body(html) is None


def test_message_from_json_error():
    body = '{"error":{"code":404,"message":"Resource not found"}}'
    assert _message_from_http_body(body) == "Resource not found"


def test_short_openai_sdk_error_strips_html():
    class FakeErr(Exception):
        status_code = 404
        body = "<!DOCTYPE html><html>Not Found</html>"

    msg = _short_openai_sdk_error(
        FakeErr("Error code: 404 - <!DOCTYPE html>..."),
        method="GET",
        path="/videos/x",
    )
    assert "HTML error page" in msg
    assert "<!DOCTYPE" not in msg
