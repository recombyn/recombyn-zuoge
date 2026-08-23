"""Unit tests for page_analyzer intelligence routing."""

from __future__ import annotations

from pathlib import Path


def test_analyze_page_images_uses_ilp_when_enabled(tmp_path, monkeypatch):
    img = tmp_path / "page.png"
    img.write_bytes(b"fake-png")

    monkeypatch.setattr("app.services.vision.ilp_client.ilp_enabled", lambda: True)

    def fake_analyze(paths, **kwargs):
        assert len(paths) == 1
        return {
            "blocks": [{"type": "text", "text": "Hi", "x": 1, "y": 2, "width": 10, "height": 12}],
            "width": 794,
            "height": 1123,
            "palette": ["#FFFFFF"],
            "engines": ["paddleocr"],
            "warnings": [],
            "sam_regions": [],
            "lama_applied": False,
        }

    monkeypatch.setattr("app.services.vision.ilp_client.analyze_pages_via_ilp", fake_analyze)

    from app.services.vision.page_analyzer import analyze_page_images

    out = analyze_page_images([Path(img)])
    assert out["engines"][0] == "ilp:analyze-pages"
    assert out["blocks"][0]["text"] == "Hi"


def test_analyze_page_images_ilp_failure_no_local_ocr(tmp_path, monkeypatch):
    img = tmp_path / "page.png"
    img.write_bytes(b"fake-png")

    monkeypatch.setattr("app.services.vision.ilp_client.ilp_enabled", lambda: True)
    monkeypatch.setattr(
        "app.services.vision.ilp_client.analyze_pages_via_ilp",
        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("down")),
    )
    monkeypatch.setattr("app.services.vision.page_analyzer.ocr_available", lambda: False)

    from app.services.vision.page_analyzer import analyze_page_images

    out = analyze_page_images([Path(img)])
    assert out["blocks"] == []
    assert any("intelligence analyze-pages failed" in w for w in out["warnings"])
