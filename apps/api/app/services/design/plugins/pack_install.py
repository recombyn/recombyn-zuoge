"""``.recombyn-plugin`` pack format + install (Phase D).

A ``.recombyn-plugin`` file is a zip with a root ``plugin.json``::

    {
      "format": "recombyn-plugin",
      "formatVersion": 1,
      "id": "festival_poster",
      "kind": "skill",          # skill | canvas
      "name": "Festival poster",
      "version": "1.0.0",
      "permissions": ["tools"],
      "install": "user"         # user (DB) | disk (plugins/…)
    }

Optional ``plugin.sig``: HMAC-SHA256 hex over a canonical digest (see
``_canonical_pack_digest``). Required only when ``DESIGN_PLUGIN_HMAC_SECRET``
is set.
"""
from __future__ import annotations

import hashlib
import hmac
import io
import json
import logging
import re
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from recombyn_plugin_sdk import (
    PLUGIN_JSON as _PLUGIN_JSON,
    PLUGIN_SIG as _PLUGIN_SIG,
    parse_plugin_manifest,
    slug_plugin_id as _slug_id,
)

logger = logging.getLogger(__name__)

# Extra files allowed inside a branded plugin pack (beyond skill meta/logo).
_PLUGIN_EXTRA_NAMES = frozenset(
    {
        _PLUGIN_JSON,
        _PLUGIN_SIG,
        "schema.json",
        "handler.py",
        "handler.py.example",
        "manifest.json",
        "index.ts",
        "index.tsx",
        "types.d.ts",
        "readme.md",
        "readme.txt",
        "license",
        "license.txt",
        "license.md",
    }
)
_PLUGIN_EXTRA_EXTS = (
    ".png",
    ".svg",
    ".webp",
    ".jpg",
    ".jpeg",
    ".gif",
    ".md",
    ".json",
    ".py",
    ".ts",
    ".tsx",
    ".css",
    ".txt",
    ".example",
)


def _settings():
    from app.core.config import settings

    return settings


def _hmac_secret() -> str:
    return str(getattr(_settings(), "design_plugin_hmac_secret", "") or "").strip()


def _disk_install_enabled() -> bool:
    return bool(getattr(_settings(), "design_plugin_disk_install", False))


def _repo_plugins_root() -> Path:
    from app.core.config import _API_ROOT

    return _API_ROOT.parent.parent / "plugins"


def plugin_entry_allowed(rel: str) -> bool:
    """Whitelist entries for ``.recombyn-plugin`` zips."""
    from app.services.design.prompts.skill_store.constants import (
        _ZIP_LOGO_EXTS,
    )

    name = Path(rel.replace("\\", "/")).name.lower()
    if name in ("_meta.json", "skill.md"):
        return True
    if name in _PLUGIN_EXTRA_NAMES:
        return True
    if name.startswith(".") or name.startswith("__macosx"):
        return False
    if name.endswith(_ZIP_LOGO_EXTS):
        return True
    return name.endswith(_PLUGIN_EXTRA_EXTS)


def _safe_rel(name: str) -> str | None:
    raw = str(name or "").replace("\\", "/").strip()
    if not raw or raw.endswith("/"):
        return None
    if raw.startswith("/") or re.match(r"^[a-zA-Z]:", raw):
        return None
    parts = [p for p in raw.split("/") if p and p != "."]
    if not parts or any(p == ".." for p in parts):
        return None
    if parts[0].lower() == "__macosx":
        return None
    return "/".join(parts)


def _zip_check(kind: str, ok: bool, label: str, detail: str | None = None) -> dict[str, Any]:
    item: dict[str, Any] = {"kind": kind, "ok": bool(ok), "label": label}
    if detail:
        item["detail"] = detail
    return item


def _read_plugin_json_from_zip(zf: zipfile.ZipFile) -> dict[str, Any] | None:
    names = {n.replace("\\", "/"): n for n in zf.namelist()}
    key = None
    for cand in (_PLUGIN_JSON, f"pack/{_PLUGIN_JSON}"):
        if cand in names:
            key = names[cand]
            break
    # Also accept single top-folder/plugin.json
    if key is None:
        tops = {n.split("/", 1)[0] for n in names if n and not n.endswith("/")}
        if len(tops) == 1:
            top = next(iter(tops))
            cand = f"{top}/{_PLUGIN_JSON}"
            if cand in names:
                key = names[cand]
    if key is None:
        return None
    try:
        data = json.loads(zf.read(key).decode("utf-8"))
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _canonical_pack_digest(zf: zipfile.ZipFile) -> bytes:
    """Stable digest: plugin.json + sorted path:sha256 lines (skip plugin.sig)."""
    rows: list[str] = []
    plugin_json_raw = b""
    for info in zf.infolist():
        if info.is_dir():
            continue
        rel = _safe_rel(info.filename)
        if not rel:
            continue
        name = Path(rel).name.lower()
        if name == _PLUGIN_SIG:
            continue
        data = zf.read(info)
        digest = hashlib.sha256(data).hexdigest()
        rows.append(f"{rel}:{digest}")
        if name == _PLUGIN_JSON:
            plugin_json_raw = data
    rows.sort()
    body = plugin_json_raw + b"\n" + ("\n".join(rows) + "\n").encode("utf-8")
    return hashlib.sha256(body).digest()


def verify_plugin_signature(zf: zipfile.ZipFile, *, secret: str) -> tuple[bool, str]:
    if not secret:
        return True, "signature_skipped"
    names = {Path(n.replace("\\", "/")).name.lower(): n for n in zf.namelist() if not n.endswith("/")}
    sig_name = names.get(_PLUGIN_SIG)
    if not sig_name:
        return False, "signature_missing"
    try:
        claimed = zf.read(sig_name).decode("utf-8").strip().lower()
    except Exception:
        return False, "signature_unreadable"
    expected = hmac.new(
        secret.encode("utf-8"), _canonical_pack_digest(zf), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(claimed, expected):
        return False, "signature_mismatch"
    return True, "signature_ok"


def looks_like_recombyn_plugin(filename: str, raw: bytes) -> bool:
    fname = str(filename or "").lower()
    if fname.endswith(".recombyn-plugin"):
        return True
    if not fname.endswith(".zip"):
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            return _read_plugin_json_from_zip(zf) is not None
    except Exception:
        return False


def _extract_plugin_zip(
    raw: bytes, dest: Path, *, max_bytes: int, max_uncompressed: int
) -> tuple[Path | None, list[dict[str, Any]], dict[str, Any] | None]:
    checks: list[dict[str, Any]] = []
    if len(raw) > max_bytes:
        checks.append(_zip_check("size", False, "zip_too_large", f"max {max_bytes}"))
        return None, checks, None
    checks.append(_zip_check("size", True, "zip_size_ok"))
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        checks.append(_zip_check("format", False, "not_a_zip"))
        return None, checks, None

    written: list[str] = []
    total = 0
    with zf:
        checks.append(_zip_check("format", True, "zip_format_ok"))
        secret = _hmac_secret()
        ok_sig, sig_label = verify_plugin_signature(zf, secret=secret)
        checks.append(_zip_check("signature", ok_sig, sig_label))
        if not ok_sig:
            return None, checks, None

        meta = _read_plugin_json_from_zip(zf)
        if not meta:
            checks.append(_zip_check("plugin_json", False, "plugin_json_missing"))
            return None, checks, None
        manifest, m_errs = parse_plugin_manifest(meta)
        if not manifest:
            checks.append(_zip_check("plugin_json", False, m_errs[0] if m_errs else "plugin_json_invalid"))
            return None, checks, None
        checks.append(_zip_check("plugin_json", True, "plugin_json_ok"))

        for info in zf.infolist():
            if info.is_dir():
                continue
            rel = _safe_rel(info.filename)
            if not rel:
                checks.append(_zip_check("path", False, "unsafe_path", info.filename))
                return None, checks, None
            if not plugin_entry_allowed(rel):
                checks.append(_zip_check("files", False, "disallowed_file", rel))
                return None, checks, None
            total += int(info.file_size or 0)
            if total > max_uncompressed:
                checks.append(_zip_check("uncompressed", False, "uncompressed_too_large"))
                return None, checks, None
            target = dest / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info, "r") as src, target.open("wb") as out:
                shutil.copyfileobj(src, out)
            written.append(rel)

    if not written:
        checks.append(_zip_check("files", False, "empty_zip"))
        return None, checks, None
    checks.append(_zip_check("path", True, "paths_ok"))

    # Resolve pack root (strip single outer folder; keep plugin.json next to pack files).
    tops = {p.split("/", 1)[0] for p in written}
    pack_dir = dest
    if len(tops) == 1:
        candidate = dest / next(iter(tops))
        if candidate.is_dir() and (candidate / _PLUGIN_JSON).is_file():
            pack_dir = candidate
        elif candidate.is_dir() and any(
            (candidate / n).is_file() for n in ("_meta.json", "SKILL.md", "manifest.json", "index.ts")
        ):
            pack_dir = candidate
    return pack_dir, checks, manifest


def _install_skill_user(*, user_id: str, pack_dir: Path, overwrite: bool, file_name: str) -> dict[str, Any]:
    from app.services.design.prompts.skill_store.user_skills import (
        _find_owned_skill_conflict,
        _import_result,
        _parse_user_skill_pack_dir,
        _apply_pack_version,
        upsert_end_user_skill,
    )

    payload, parse_errs = _parse_user_skill_pack_dir(pack_dir)
    checks: list[dict[str, Any]] = []
    if parse_errs or not payload:
        checks.append(_zip_check("meta_valid", False, "meta_invalid"))
        return _import_result(
            status="rejected",
            file_name=file_name,
            checks=checks,
            errors=parse_errs or ["meta_invalid"],
            scan_ok=False,
        )
    checks.append(_zip_check("meta_valid", True, "meta_ok"))
    conflict = _find_owned_skill_conflict(
        user_id=user_id,
        skill_key=str(payload.get("skillKey") or ""),
        name=str(payload.get("name") or ""),
    )
    if conflict and not conflict.get("mine"):
        checks.append(_zip_check("ownership", False, "skill_key_taken_other"))
        return _import_result(
            status="rejected",
            file_name=file_name,
            checks=checks,
            errors=["skill_key_taken_other"],
            existing=conflict,
            scan_ok=False,
        )
    if conflict and conflict.get("mine") and not overwrite:
        return _import_result(
            status="exists",
            file_name=file_name,
            checks=checks,
            errors=[],
            existing=conflict,
            scan_ok=True,
        )
    item = upsert_end_user_skill(user_id=user_id, payload=payload)
    _apply_pack_version(
        uid=user_id,
        skill_id=int(item.get("id") or 0),
        pack_ver=str(payload.get("packVersion") or "") or None,
    )
    return _import_result(
        status="ok",
        file_name=file_name,
        checks=checks,
        errors=[],
        item=item,
        scan_ok=True,
    )


def _copy_pack_to_disk(*, pack_dir: Path, kind: str, plugin_id: str) -> Path:
    root = _repo_plugins_root()
    sub = "skills" if kind == "skill" else "canvas"
    dest = root / sub / plugin_id
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(pack_dir, dest)
    # Drop signature file from installed tree (not needed at runtime).
    sig = dest / _PLUGIN_SIG
    if sig.is_file():
        sig.unlink()
    return dest


def install_recombyn_plugin(
    *,
    user_id: str,
    filename: str,
    raw: bytes,
    overwrite: bool = False,
) -> dict[str, Any]:
    """Install a ``.recombyn-plugin`` (or ``.zip`` that contains ``plugin.json``)."""
    from app.services.design.prompts.skill_store.constants import (
        _MAX_USER_SKILL_ZIP_BYTES,
        _MAX_USER_SKILL_ZIP_UNCOMPRESSED,
    )
    from app.services.design.prompts.skill_store.user_skills import _import_result

    uid = str(user_id or "").strip()
    fname = str(filename or "pack.recombyn-plugin").strip() or "pack.recombyn-plugin"
    lower = fname.lower()
    checks: list[dict[str, Any]] = []

    if not (
        lower.endswith(".recombyn-plugin")
        or lower.endswith(".zip")
    ):
        checks.append(_zip_check("ext", False, "need_recombyn_plugin"))
        return _import_result(
            status="rejected",
            file_name=fname,
            checks=checks,
            errors=["need_recombyn_plugin"],
            scan_ok=False,
        )
    checks.append(_zip_check("ext", True, "plugin_extension"))

    if not raw:
        checks.append(_zip_check("empty", False, "empty_file"))
        return _import_result(
            status="rejected", file_name=fname, checks=checks, errors=["empty_file"], scan_ok=False
        )

    tmp = Path(tempfile.mkdtemp(prefix="rcb-plugin-"))
    try:
        pack_dir, extract_checks, manifest = _extract_plugin_zip(
            raw,
            tmp,
            max_bytes=_MAX_USER_SKILL_ZIP_BYTES,
            max_uncompressed=_MAX_USER_SKILL_ZIP_UNCOMPRESSED,
        )
        checks.extend(extract_checks)
        if not pack_dir or not manifest:
            errs = [c["label"] for c in extract_checks if not c.get("ok")]
            return _import_result(
                status="rejected", file_name=fname, checks=checks, errors=errs or ["extract_failed"], scan_ok=False
            )

        kind = str(manifest["kind"])
        install = str(manifest["install"])
        plugin_id = _slug_id(str(manifest.get("id") or pack_dir.name))

        if install == "disk":
            if not _disk_install_enabled():
                checks.append(_zip_check("disk", False, "disk_install_disabled"))
                return _import_result(
                    status="rejected",
                    file_name=fname,
                    checks=checks,
                    errors=["disk_install_disabled"],
                    scan_ok=False,
                )
            dest = _copy_pack_to_disk(pack_dir=pack_dir, kind=kind, plugin_id=plugin_id)
            checks.append(_zip_check("disk", True, "disk_installed"))
            # Skill disk packs still need ensure/hot-reload; canvas needs rebuild note.
            if kind == "skill":
                try:
                    from app.services.design.prompts.skill_store import ensure_design_skills

                    ensure_design_skills(force=True)
                except Exception:
                    logger.exception("ensure_design_skills after disk install")
            return {
                "status": "ok",
                "fileName": fname,
                "scan": {"ok": True, "checks": checks, "errors": []},
                "item": {
                    "id": plugin_id,
                    "kind": kind,
                    "name": manifest.get("name"),
                    "version": manifest.get("version"),
                    "install": "disk",
                    "path": str(dest),
                    "permissions": manifest.get("permissions") or [],
                },
                "existing": None,
                "plugin": manifest,
            }

        # user install — skill only
        if kind != "skill":
            checks.append(_zip_check("kind", False, "user_install_skill_only"))
            return _import_result(
                status="rejected",
                file_name=fname,
                checks=checks,
                errors=["user_install_skill_only"],
                scan_ok=False,
            )
        result = _install_skill_user(
            user_id=uid, pack_dir=pack_dir, overwrite=overwrite, file_name=fname
        )
        # Merge checks
        scan = result.get("scan") if isinstance(result.get("scan"), dict) else {}
        merged = list(checks) + list(scan.get("checks") or [])
        result["scan"] = {
            "ok": bool(scan.get("ok")),
            "checks": merged,
            "errors": list(scan.get("errors") or result.get("errors") or []),
        }
        result["plugin"] = manifest
        return result
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def sign_plugin_zip_bytes(raw: bytes, *, secret: str) -> bytes:
    """Return a new zip with ``plugin.sig`` written/replaced (dev/packaging helper)."""
    if not secret:
        raise ValueError("secret required")
    unsigned = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(raw), "r") as src, zipfile.ZipFile(
        unsigned, "w", compression=zipfile.ZIP_DEFLATED
    ) as dst:
        for info in src.infolist():
            if info.is_dir():
                continue
            rel = _safe_rel(info.filename)
            if not rel:
                continue
            if Path(rel).name.lower() == _PLUGIN_SIG:
                continue
            dst.writestr(rel, src.read(info))
    unsigned_bytes = unsigned.getvalue()
    with zipfile.ZipFile(io.BytesIO(unsigned_bytes), "r") as zf:
        digest = _canonical_pack_digest(zf)
    sig = hmac.new(secret.encode("utf-8"), digest, hashlib.sha256).hexdigest()
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(unsigned_bytes), "r") as src, zipfile.ZipFile(
        out, "w", compression=zipfile.ZIP_DEFLATED
    ) as dst:
        for info in src.infolist():
            if info.is_dir():
                continue
            dst.writestr(info.filename, src.read(info))
        dst.writestr(_PLUGIN_SIG, sig + "\n")
    return out.getvalue()
