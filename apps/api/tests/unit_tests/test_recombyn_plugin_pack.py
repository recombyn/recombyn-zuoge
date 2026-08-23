"""Tests for ``.recombyn-plugin`` pack install."""
from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pytest

from app.services.design.plugins import pack_install


def _zip_bytes(files: dict[str, str | bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, body in files.items():
            data = body.encode("utf-8") if isinstance(body, str) else body
            zf.writestr(name, data)
    return buf.getvalue()


def _skill_plugin_files(**plugin_extra: object) -> dict[str, str]:
    plugin = {
        "format": "recombyn-plugin",
        "formatVersion": 1,
        "id": "demo_skill",
        "kind": "skill",
        "name": "Demo skill",
        "version": "1.0.0",
        "install": "user",
        "permissions": ["tools"],
    }
    plugin.update(plugin_extra)
    return {
        "plugin.json": json.dumps(plugin),
        "_meta.json": json.dumps(
            {
                "skill_key": "demo_skill",
                "name": "demo_skill",
                "preferred_tools": ["create_frame", "create_text"],
                "version": "1.0.0",
            }
        ),
        "SKILL.md": "# Demo\n\nCreate a simple board.\n",
    }


def test_parse_plugin_manifest_ok():
    meta, errs = pack_install.parse_plugin_manifest(
        {
            "format": "recombyn-plugin",
            "formatVersion": 1,
            "id": "x",
            "kind": "skill",
            "name": "X",
        }
    )
    assert not errs
    assert meta is not None
    assert meta["kind"] == "skill"
    assert meta["install"] == "user"


def test_canvas_requires_disk_install():
    meta, errs = pack_install.parse_plugin_manifest(
        {
            "format": "recombyn-plugin",
            "formatVersion": 1,
            "id": "wm",
            "kind": "canvas",
            "install": "user",
        }
    )
    assert meta is None
    assert "canvas_requires_disk_install" in errs


def test_install_skill_user(monkeypatch):
    monkeypatch.setattr(pack_install, "_hmac_secret", lambda: "")
    captured: dict = {}

    def fake_user(**kwargs):
        captured.update(kwargs)
        return {
            "status": "ok",
            "fileName": kwargs["file_name"],
            "scan": {"ok": True, "checks": [], "errors": []},
            "item": {"id": 1, "name": "Demo skill", "skillKey": "user.demo_skill"},
            "existing": None,
        }

    monkeypatch.setattr(pack_install, "_install_skill_user", fake_user)
    raw = _zip_bytes(_skill_plugin_files())
    result = pack_install.install_recombyn_plugin(
        user_id="u1",
        filename="demo.recombyn-plugin",
        raw=raw,
        overwrite=False,
    )
    assert result["status"] == "ok"
    assert captured.get("user_id") == "u1"
    assert result.get("plugin", {}).get("id") == "demo_skill"


def test_signature_required_when_secret_set(monkeypatch):
    monkeypatch.setattr(pack_install, "_hmac_secret", lambda: "test-secret")
    raw = _zip_bytes(_skill_plugin_files())
    result = pack_install.install_recombyn_plugin(
        user_id="u1",
        filename="demo.recombyn-plugin",
        raw=raw,
    )
    assert result["status"] == "rejected"
    assert "signature_missing" in (result.get("scan") or {}).get("errors") or any(
        c.get("label") == "signature_missing"
        for c in ((result.get("scan") or {}).get("checks") or [])
    )


def test_sign_and_verify_roundtrip(monkeypatch):
    monkeypatch.setattr(pack_install, "_hmac_secret", lambda: "test-secret")
    raw = _zip_bytes(_skill_plugin_files())
    signed = pack_install.sign_plugin_zip_bytes(raw, secret="test-secret")
    with zipfile.ZipFile(io.BytesIO(signed), "r") as zf:
        ok, label = pack_install.verify_plugin_signature(zf, secret="test-secret")
    assert ok
    assert label == "signature_ok"


def test_disk_install_canvas(monkeypatch, tmp_path):
    monkeypatch.setattr(pack_install, "_hmac_secret", lambda: "")
    monkeypatch.setattr(pack_install, "_disk_install_enabled", lambda: True)
    monkeypatch.setattr(pack_install, "_repo_plugins_root", lambda: tmp_path)

    files = {
        "plugin.json": json.dumps(
            {
                "format": "recombyn-plugin",
                "formatVersion": 1,
                "id": "canvas-watermark",
                "kind": "canvas",
                "name": "Watermark",
                "version": "1.0.0",
                "install": "disk",
            }
        ),
        "manifest.json": json.dumps({"id": "canvas-watermark", "name": "Watermark"}),
        "index.ts": "export default {}\n",
        "icon.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>\n",
    }
    raw = _zip_bytes(files)
    result = pack_install.install_recombyn_plugin(
        user_id="u1",
        filename="wm.recombyn-plugin",
        raw=raw,
    )
    assert result["status"] == "ok"
    dest = Path(result["item"]["path"])
    assert dest.is_dir()
    assert (dest / "index.ts").is_file()
    assert (dest / "plugin.json").is_file()


def test_looks_like_plugin_by_extension():
    assert pack_install.looks_like_recombyn_plugin("x.recombyn-plugin", b"PK\x03\x04")
    assert not pack_install.looks_like_recombyn_plugin("x.txt", b"nope")
