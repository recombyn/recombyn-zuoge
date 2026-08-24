"""Plaza submission CRUD."""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

from app.services.plaza.cover import cover_json_dumps, validate_cover_for_publish
from app.services.plaza.db import init_plaza_db

_MAX_DOC_BYTES = 12 * 1024 * 1024  # ~12MB JSON
# Align with home hero: website | mobile | image | poster | video
_CATEGORIES = frozenset({"website", "mobile", "image", "poster", "video"})


class PlazaError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _parse_cover(row: Any) -> dict[str, Any] | None:
    """Plaza list cover only — never loads full document_json here."""
    try:
        raw = row["cover_json"]
    except (KeyError, IndexError, TypeError):
        return None
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


def _row_int(row: Any, key: str, default: int = 0) -> int:
    try:
        val = row[key]
    except (KeyError, IndexError, TypeError):
        return default
    if val is None:
        return default
    try:
        return max(0, int(val))
    except (TypeError, ValueError):
        return default


def _parse_panel_urls(row: Any) -> list[dict[str, str]]:
    try:
        raw = row["panel_urls_json"]
    except (KeyError, IndexError, TypeError):
        return []
    if not isinstance(raw, str) or not raw.strip():
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    out: list[dict[str, str]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        out.append(
            {
                "id": str(item.get("id") or f"panel-{len(out)}"),
                "name": str(item.get("name") or "").strip() or f"面板 {len(out) + 1}",
                "url": url,
            }
        )
    return out


def _row_to_meta(row: Any, *, include_document: bool = False, allow_cover_side_effects: bool = True) -> dict[str, Any]:
    status = str(row["status"] or "")
    out: dict[str, Any] = {
        "id": row["id"],
        "projectId": row["project_id"],
        "userId": row["user_id"],
        "authorName": row["author_name"],
        "authorAvatar": row["author_avatar"],
        "title": row["title"],
        "category": row["category"] or "website",
        "status": status,
        "rejectReason": row["reject_reason"],
        "likeCount": _row_int(row, "like_count"),
        "useCount": _row_int(row, "use_count"),
        "isVisible": _row_int(row, "is_visible", 1) == 1,
        "createdAt": int(float(row["created_at"]) * 1000),
        "updatedAt": int(float(row["updated_at"]) * 1000),
        "reviewedAt": (
            int(float(row["reviewed_at"]) * 1000) if row["reviewed_at"] is not None else None
        ),
        "source": "plaza",
        # Plaza list fields — not full canvas document.
        "coverDocument": _parse_cover(row),
    }
    default_covers = _default_cover_urls(row, allow_side_effects=allow_cover_side_effects)
    custom_cover = _custom_cover_url(row)
    # thumbnailUrl is always an array (max 4). Admin custom is a single-url override.
    if custom_cover:
        out["customCoverImageUrl"] = custom_cover
        out["thumbnailUrl"] = [custom_cover]
    elif default_covers:
        out["thumbnailUrl"] = default_covers
    # Public panel PNG URLs only after approve (left-rail images on C-end).
    if status == "approved":
        panels = _parse_panel_urls(row)
        if panels:
            out["panelUrls"] = panels
    if include_document:
        try:
            out["document"] = json.loads(row["document_json"])
        except json.JSONDecodeError:
            out["document"] = None
    return out


def _row_cover_field(row: Any, key: str) -> str | None:
    try:
        raw = row[key]
    except (KeyError, IndexError, TypeError):
        return None
    if raw is None:
        return None
    text = str(raw).strip()
    return text or None


def _parse_cover_urls(raw: str | None) -> list[str]:
    """Decode cover_image_url JSON array."""
    text = (raw or "").strip()
    if not text:
        return []
    if text.startswith("["):
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, list):
            out: list[str] = []
            for item in parsed:
                url = _normalize_cover_url(str(item or ""))
                if url:
                    out.append(url)
                if len(out) >= 4:
                    break
            return out
    return []


def _encode_cover_urls(urls: list[str] | None) -> str | None:
    cleaned: list[str] = []
    for item in urls or []:
        url = _normalize_cover_url(item)
        if url and url not in cleaned:
            cleaned.append(url)
        if len(cleaned) >= 4:
            break
    if not cleaned:
        return None
    return json.dumps(cleaned, ensure_ascii=False)


def _custom_cover_url(row: Any) -> str | None:
    return _row_cover_field(row, "custom_cover_image_url")


def _default_cover_url(row: Any) -> str | None:
    """First default cover URL."""
    urls = _default_cover_urls(row)
    return urls[0] if urls else None


def _default_cover_urls(row: Any, *, allow_side_effects: bool = True) -> list[str]:
    """Project snapshot covers; optional backfill/repair (disabled on feed/list)."""
    existing = _row_cover_field(row, "cover_image_url")
    if existing:
        urls = _parse_cover_urls(existing)
        if not allow_side_effects:
            return urls
        return _repair_project_ref_covers(row, urls)
    try:
        if row["cover_image_url"] is not None:
            return []
    except (KeyError, IndexError, TypeError):
        pass
    if not allow_side_effects:
        return []
    one = _backfill_cover_from_project(row)
    return [one] if one else []


def _strip_cache_bust_query(url: str) -> str:
    """Drop ?v= / &_= so we store the stable object URL."""
    cleaned = url
    for token in ("v=", "_="):
        if f"?{token}" not in cleaned and f"&{token}" not in cleaned:
            continue
        from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

        parts = urlsplit(cleaned)
        q = [
            (k, v)
            for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if k not in ("v", "_")
        ]
        return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(q), parts.fragment))
    return cleaned


def _normalize_cover_url(url: str | None) -> str | None:
    """Persistable cover URL — drop data: and cache-bust query junk."""
    raw = (url or "").strip()
    if not raw or raw.startswith("data:"):
        return None
    cleaned = _strip_cache_bust_query(raw).strip()
    if not cleaned or len(cleaned) > 2000:
        return None
    return cleaned


def _clamp_title(title: str) -> str:
    name = (title or "").strip() or "Untitled"
    return name[:120] if len(name) > 120 else name


def _normalize_category(category: str | None) -> str:
    cat = (category or "website").strip().lower()
    return cat if cat in _CATEGORIES else "website"


def _freeze_document_snapshot(document: dict[str, Any]) -> dict[str, Any]:
    """Deep-copy via JSON so client mutations cannot share object identity."""
    try:
        snapshot = json.loads(json.dumps(document, ensure_ascii=False))
    except (TypeError, ValueError) as err:
        raise PlazaError("invalid_document", "document must be JSON-serializable") from err
    if not isinstance(snapshot, dict):
        raise PlazaError("invalid_document", "document must be an object")
    return snapshot


def _require_submission_id(submission_id: str) -> str:
    sid = (submission_id or "").strip()
    if not sid:
        raise PlazaError("not_found", "Submission not found")
    return sid


def _parse_document_json(raw: Any) -> dict[str, Any] | None:
    try:
        parsed = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _panel_urls_for_meta(panel_urls: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    if not panel_urls:
        return []
    return [
        {
            "id": str(p.get("id") or ""),
            "name": str(p.get("name") or ""),
            "url": str(p.get("url") or ""),
        }
        for p in panel_urls
        if p.get("url")
    ]


def _validate_admin_cover_url(cover_url: str | None) -> str | None:
    url = (cover_url or "").strip() or None
    if not url:
        return None
    if len(url) > 2000:
        raise PlazaError("invalid_document", "Cover URL too long")
    if not (
        url.startswith("http://")
        or url.startswith("https://")
        or url.startswith("/")
        or url.startswith("data:image/")
    ):
        raise PlazaError("invalid_document", "Cover URL must be http(s) or site path")
    return url


def _assert_can_submit(session: Any, user_id: str, project_id: str) -> None:
    from app import crud

    active = crud.get_active_plaza_for_project(
        session=session, user_id=user_id, project_id=project_id
    )
    if not active:
        return
    if active.status == "pending":
        raise PlazaError("already_pending", "This project is already under review")
    raise PlazaError("already_published", "This project is already published on the plaza")


def _normalize_feed_tab(tab: str | None) -> str:
    tab_n = (tab or "recommended").strip().lower()
    return tab_n if tab_n in ("recommended", "latest", "following") else "recommended"


def _feed_page_args(
    *,
    limit: int | None,
    page: int,
    page_size: int | None,
) -> tuple[int, int, int]:
    ps = page_size if page_size is not None else (limit if limit is not None else 20)
    page_n = max(1, int(page or 1))
    page_size_n = max(1, min(int(ps or 20), 50))
    offset = (page_n - 1) * page_size_n
    return page_n, page_size_n, offset


def _load_avatar_fallback_map(session: Any, user_ids: list[str]) -> dict[str, str]:
    from app import crud

    return crud.load_user_avatar_map(session=session, user_ids=user_ids)


def _attach_avatar_fallbacks(
    rows: list[Any],
    avatar_by_user: dict[str, str],
    *,
    allow_cover_side_effects: bool = True,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for r in rows:
        meta = _row_to_meta(r, allow_cover_side_effects=allow_cover_side_effects)
        if not (meta.get("authorAvatar") or "").strip():
            fallback = avatar_by_user.get(str(r["user_id"]) or "")
            if fallback:
                meta["authorAvatar"] = fallback
        items.append(meta)
    return items


def _empty_feed_page(page_n: int, page_size_n: int, tab_n: str) -> dict[str, Any]:
    return {
        "items": [],
        "page": page_n,
        "pageSize": page_size_n,
        "total": 0,
        "hasMore": False,
        "tab": tab_n,
    }


def _maybe_backfill_panels(
    session: Any,
    *,
    submission_id: str,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Legacy approved posts: generate PNG panel URLs on first detail read."""
    if meta.get("status") != "approved" or meta.get("panelUrls"):
        return meta
    document = meta.get("document")
    if not isinstance(document, dict):
        return meta
    from app.services.plaza.panel_png import generate_panel_png_urls

    from app import crud

    panel_urls = generate_panel_png_urls(submission_id=submission_id, document=document)
    if not panel_urls:
        return meta
    row = crud.get_plaza_submission(session=session, submission_id=submission_id)
    if not row:
        return meta
    row.panel_urls_json = json.dumps(panel_urls, ensure_ascii=False)
    row.updated_at = time.time()
    session.add(row)
    session.commit()
    meta["panelUrls"] = _panel_urls_for_meta(panel_urls)
    return meta


def _project_thumbnail_key(user_id: str, project_id: str) -> str | None:
    """Live project cover object key (may be deleted on the next project save)."""
    pid = (project_id or "").strip()
    uid = (user_id or "").strip()
    if not pid or not uid:
        return None
    try:
        from sqlmodel import Session

        from app import crud
        from app.core.db import engine
        from app.services.db import init_schema

        init_schema()
        with Session(engine) as session:
            prow = crud.get_project_for_user(
                session=session, user_id=uid, project_id=pid
            )
        if not prow:
            return None
        raw = str(prow.thumbnail_key or "").strip()
        if not raw:
            return None
        # Project covers may be a JSON array — plaza isolate uses the first tile.
        try:
            from app.services.projects import _parse_thumb_entries

            entries = _parse_thumb_entries(raw)
            return entries[0] if entries else None
        except Exception:
            return raw
    except Exception:
        return None


def _project_thumbnail_url(user_id: str, project_id: str) -> str | None:
    """Public URL for the project's current thumb key (not plaza-owned)."""
    key = _project_thumbnail_key(user_id, project_id)
    if not key:
        return None
    try:
        from app.services.projects import _url

        url = _url(key)
        return _normalize_cover_url(str(url) if url else None)
    except Exception:
        return None


def _cover_ext_from_name(name: str) -> str:
    lower = (name or "").lower()
    for ext in ("webp", "png", "jpg", "jpeg", "gif"):
        if f".{ext}" in lower.split("?", 1)[0]:
            return "jpg" if ext == "jpeg" else ext
    return "webp"


def _content_type_for_ext(ext: str) -> str:
    return {
        "webp": "image/webp",
        "png": "image/png",
        "jpg": "image/jpeg",
        "gif": "image/gif",
    }.get(ext, "image/webp")


def _is_plaza_owned_cover_url(url: str | None) -> bool:
    """True when URL already points at plaza/{id}/cover(s) (safe from project delete)."""
    text = (url or "").strip().lower()
    return "/plaza/" in text and ("/cover." in text or "/covers/" in text)


def _upload_cover_blob(submission_id: str, index: int, data: bytes, ext: str = "png") -> str | None:
    try:
        from app.services.storage import get_storage, put_bytes
    except Exception:
        return None
    sid = (submission_id or "").strip()
    if not sid or not data:
        return None
    dest_key = f"plaza/{sid}/covers/{index}.{ext}"
    try:
        put_bytes(
            dest_key,
            data,
            content_type=_content_type_for_ext(ext),
            cache_control="public, max-age=31536000",
        )
        url = get_storage().url_for(dest_key)
        return _normalize_cover_url(str(url) if url else None)
    except Exception:
        return None


def _isolate_plaza_cover(
    *,
    submission_id: str,
    user_id: str,
    project_id: str,
    thumbnail_url: str | None = None,
) -> str | None:
    """Copy project thumb bytes into ``plaza/{id}/covers/0.*`` (single fallback)."""
    urls = _isolate_plaza_cover_urls(
        submission_id=submission_id,
        user_id=user_id,
        project_id=project_id,
        document=None,
        thumbnail_url=thumbnail_url,
    )
    return urls[0] if urls else None


def _overlay_json_list(raw: Any) -> list[Any]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []
    return []


def _overlay_plain_text(attrs: dict[str, Any]) -> str:
    origin_lines: list[str] = []
    for block in _overlay_json_list(attrs.get("ORIGIN_DATA")):
        if not isinstance(block, dict):
            continue
        children = block.get("children")
        if not isinstance(children, list):
            continue
        origin_lines.append(
            "".join(str(c.get("text") or "") for c in children if isinstance(c, dict))
        )
    origin = "\n".join(part for part in origin_lines if part).strip()
    if origin:
        return origin
    data_lines: list[str] = []
    for run in _overlay_json_list(attrs.get("DATA")):
        if not isinstance(run, dict):
            continue
        chars = run.get("chars")
        if not isinstance(chars, list):
            continue
        data_lines.append(
            "".join(str(item.get("char") or "") for item in chars if isinstance(item, dict))
        )
    data = "\n".join(data_lines).strip()
    if data:
        return data
    md = attrs.get("markdown")
    if isinstance(md, str) and md.strip():
        return md.strip()
    return ""


def _document_has_overlay_text(document: dict[str, Any] | None) -> bool:
    """True when the board has readable text — list covers must not be raw bitmaps alone."""
    if not isinstance(document, dict):
        return False
    dsl = document.get("deltaSetLike")
    if not isinstance(dsl, dict):
        return False
    for key, raw in dsl.items():
        if key == "ROOT" or not isinstance(raw, dict):
            continue
        kind = str(raw.get("key") or "").strip().lower()
        if kind != "text":
            continue
        attrs = raw.get("attrs") if isinstance(raw.get("attrs"), dict) else {}
        if _overlay_plain_text(attrs):
            return True
    return False


def _isolate_plaza_cover_urls(
    *,
    submission_id: str,
    user_id: str,
    project_id: str,
    document: dict[str, Any] | None,
    thumbnail_url: str | None = None,
) -> list[str]:
    """Build up to 4 plaza-owned cover URLs from document images + project thumb.

    When the artboard has overlay text / UI chrome, skip raw image tiles — those
    strip typography (posters) and show lifestyle photos instead of app UI.
    The feed then falls back to ``coverDocument`` client rasterization.
    """
    sid = (submission_id or "").strip()
    out: list[str] = []

    # Posters / UI boards: never promote a lone create_image as the card face.
    if _document_has_overlay_text(document):
        return []

    if isinstance(document, dict) and sid:
        try:
            from app.services.plaza.panel_png import (
                _list_panel_candidates,
                _load_image_bytes,
                _to_png_bytes,
            )
        except Exception:
            _list_panel_candidates = None  # type: ignore[assignment]
        else:
            for i, panel in enumerate(_list_panel_candidates(document)[:4]):
                src = str(panel.get("src") or "").strip()
                blob = _load_image_bytes(src) if src else None
                png = _to_png_bytes(blob) if blob else None
                if not png:
                    continue
                url = _upload_cover_blob(sid, i, png, "png")
                if url:
                    out.append(url)

    if out:
        return out

    # Fallback: project thumb / client URL → single cover tile.
    try:
        from app.services.storage import get_bytes
    except Exception:
        get_bytes = None  # type: ignore[assignment]

    src_key = _project_thumbnail_key(user_id, project_id)
    data = get_bytes(src_key) if (get_bytes and src_key) else None
    if data and sid:
        ext = _cover_ext_from_name(src_key or "")
        url = _upload_cover_blob(sid, 0, data, ext)
        if url:
            return [url]

    one = _normalize_cover_url(thumbnail_url) or _project_thumbnail_url(user_id, project_id)
    return [one] if one else []


def _persist_default_cover(
    submission_id: str,
    url: str | list[str],
    *,
    only_if_null: bool,
) -> None:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    sid = (submission_id or "").strip()
    encoded = _encode_cover_urls(url if isinstance(url, list) else [url])
    if not sid or not encoded:
        return
    try:
        with Session(engine) as session:
            row = crud.get_plaza_submission(session=session, submission_id=sid)
            if not row:
                return
            if only_if_null and row.cover_image_url is not None:
                return
            row.cover_image_url = encoded
            session.add(row)
            session.commit()
    except Exception:
        pass


def _backfill_cover_from_project(row: Any) -> str | None:
    """One-time fill of default cover_image_url from an isolated plaza copy."""
    try:
        sid = str(row["id"] or "").strip()
        uid = str(row["user_id"] or "").strip()
        pid = str(row["project_id"] or "").strip()
        if row["cover_image_url"] is not None:
            return None
        doc_raw = row["document_json"]
    except (KeyError, IndexError, TypeError):
        return None
    document = None
    try:
        parsed = json.loads(doc_raw or "{}")
        if isinstance(parsed, dict):
            document = parsed
    except (TypeError, ValueError, json.JSONDecodeError):
        document = None
    urls = _isolate_plaza_cover_urls(
        submission_id=sid,
        user_id=uid,
        project_id=pid,
        document=document,
    )
    if not urls or not sid:
        return None
    _persist_default_cover(sid, urls, only_if_null=True)
    return urls[0]


def _repair_project_ref_cover(row: Any, existing: str) -> str:
    urls = _repair_project_ref_covers(row, [existing])
    return urls[0] if urls else existing


def _repair_project_ref_covers(row: Any, existing: list[str]) -> list[str]:
    """Re-copy covers that still point at deletable ``projects/.../thumb-*`` URLs."""
    if not existing:
        return []
    if all(_is_plaza_owned_cover_url(u) or "/covers/" in (u or "").lower() for u in existing):
        return existing
    needs = any(
        ("/projects/" in u.lower() or "/thumb-" in u.lower()) and not _is_plaza_owned_cover_url(u)
        for u in existing
    )
    if not needs:
        return existing
    try:
        sid = str(row["id"] or "").strip()
        uid = str(row["user_id"] or "").strip()
        pid = str(row["project_id"] or "").strip()
        doc_raw = row["document_json"]
    except (KeyError, IndexError, TypeError):
        return existing
    if not sid or not pid:
        return existing
    document = None
    try:
        parsed = json.loads(doc_raw or "{}")
        if isinstance(parsed, dict):
            document = parsed
    except (TypeError, ValueError, json.JSONDecodeError):
        document = None
    isolated = _isolate_plaza_cover_urls(
        submission_id=sid,
        user_id=uid,
        project_id=pid,
        document=document,
    )
    if not isolated:
        return existing
    _persist_default_cover(sid, isolated, only_if_null=False)
    return isolated


def submit_to_plaza(
    *,
    user_id: str,
    author_name: str,
    author_avatar: str | None,
    project_id: str,
    title: str,
    document: dict[str, Any],
    category: str = "resume",
    thumbnail_url: str | list[str] | None = None,
) -> dict[str, Any]:
    """
    Create an isolated plaza submission snapshot.

    Isolation rules:
    - Deep-copies ``document`` into ``plaza_submissions.document_json`` (JSON round-trip).
    - Never reads or writes the live ``projects`` document after insert.
    - ``project_id`` is provenance only (badge / duplicate-submit guard), not a live link.
    - List covers copy up to 4 design-element images into ``plaza/{id}/covers/*``.
    """
    init_plaza_db()
    pid = (project_id or "").strip()
    if not pid:
        raise PlazaError("invalid_project", "projectId is required")
    if not isinstance(document, dict):
        raise PlazaError("invalid_document", "document must be an object")

    name = _clamp_title(title)
    cat = _normalize_category(category)
    snapshot = _freeze_document_snapshot(document)

    cover_ok, cover_err = validate_cover_for_publish(snapshot)
    if not cover_ok:
        raise PlazaError(
            cover_err or "invalid_document",
            "Document is required to publish",
        )

    raw = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
    if len(raw.encode("utf-8")) > _MAX_DOC_BYTES:
        raise PlazaError("document_too_large", "Document is too large to publish")
    cover_raw = cover_json_dumps(snapshot)

    client_thumb: str | None = None
    if isinstance(thumbnail_url, list):
        for item in thumbnail_url:
            client_thumb = _normalize_cover_url(str(item or ""))
            if client_thumb:
                break
    else:
        client_thumb = _normalize_cover_url(thumbnail_url)

    now = time.time()
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    with Session(engine) as session:
        _assert_can_submit(session, user_id, pid)
        sid = f"plaza_{uuid.uuid4().hex[:16]}"
        cover_urls = _isolate_plaza_cover_urls(
            submission_id=sid,
            user_id=user_id,
            project_id=pid,
            document=snapshot,
            thumbnail_url=client_thumb,
        )
        cover_img = _encode_cover_urls(cover_urls)
        row = crud.create_plaza_submission(
            session=session,
            submission_id=sid,
            project_id=pid,
            user_id=user_id,
            author_name=(author_name or "").strip() or "User",
            author_avatar=(author_avatar or "").strip() or None,
            title=name,
            category=cat,
            document_json=raw,
            cover_json=cover_raw,
            cover_image_url=cover_img,
            created_at=now,
        )
        return _row_to_meta(row.model_dump())


def list_feed(
    limit: int | None = None,
    *,
    page: int = 1,
    page_size: int | None = None,
    tab: str = "recommended",
    author_ids: list[str] | None = None,
    category: str | None = None,
    visible_only: bool = True,
) -> dict[str, Any]:
    """
    Paginated approved feed.
    tab: recommended | latest | following
    following requires author_ids (from Me follows API or client).
    category: optional plaza category filter (website|mobile|image|poster|video).
    """
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_plaza_db()
    page_n, page_size_n, offset = _feed_page_args(limit=limit, page=page, page_size=page_size)
    tab_n = _normalize_feed_tab(tab)

    with Session(engine) as session:
        page_data = crud.list_plaza_feed(
            session=session,
            tab=tab_n,
            author_ids=author_ids,
            category=category,
            visible_only=visible_only,
            offset=offset,
            limit=page_size_n,
            categories=_CATEGORIES,
        )
        if page_data is None:
            return _empty_feed_page(page_n, page_size_n, tab_n)
        rows, total = page_data
        dumps = [r.model_dump() for r in rows]
        user_ids = list({str(r["user_id"]) for r in dumps if r.get("user_id")})
        avatar_by_user = _load_avatar_fallback_map(session, user_ids)

    items = _attach_avatar_fallbacks(
        dumps, avatar_by_user, allow_cover_side_effects=False
    )
    return {
        "items": items,
        "page": page_n,
        "pageSize": page_size_n,
        "total": total,
        "hasMore": offset + len(items) < total,
        "tab": tab_n,
    }


def list_admin(status: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_plaza_db()
    with Session(engine) as session:
        rows = crud.list_plaza_admin(session=session, status=status, limit=limit)
    return [
        _row_to_meta(r.model_dump(), allow_cover_side_effects=False) for r in rows
    ]


def get_submission(submission_id: str, *, include_document: bool = False) -> dict[str, Any] | None:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_plaza_db()
    with Session(engine) as session:
        row = crud.get_plaza_submission(session=session, submission_id=submission_id)
        if not row:
            return None
        meta = _row_to_meta(row.model_dump(), include_document=include_document)
        if include_document:
            meta = _maybe_backfill_panels(
                session, submission_id=str(row.id), meta=meta
            )
        return meta


def set_submission_visible(submission_id: str, visible: bool) -> dict[str, Any]:
    """Toggle C-end visibility without changing review status."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_plaza_db()
    sid = _require_submission_id(submission_id)
    now = time.time()
    with Session(engine) as session:
        row = crud.get_plaza_submission(session=session, submission_id=sid)
        if not row:
            raise PlazaError("not_found", "Submission not found")
        row.is_visible = 1 if visible else 0
        row.updated_at = now
        session.add(row)
        session.commit()
        session.refresh(row)
        return _row_to_meta(row.model_dump())


def update_submission_title(submission_id: str, title: str) -> dict[str, Any]:
    """Admin rename of plaza listing title (does not touch live project)."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_plaza_db()
    sid = _require_submission_id(submission_id)
    name = _clamp_title(title)
    now = time.time()
    with Session(engine) as session:
        row = crud.get_plaza_submission(session=session, submission_id=sid)
        if not row:
            raise PlazaError("not_found", "Submission not found")
        row.title = name
        row.updated_at = now
        session.add(row)
        session.commit()
        session.refresh(row)
        return _row_to_meta(row.model_dump())


def set_cover_image(submission_id: str, cover_url: str | None) -> dict[str, Any]:
    """Set or clear admin custom cover (custom_cover_image_url).

    Does not touch default cover_image_url (project snapshot). Display prefers
    custom when set, otherwise the default.
    """
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_plaza_db()
    sid = _require_submission_id(submission_id)
    url = _validate_admin_cover_url(cover_url)
    now = time.time()
    with Session(engine) as session:
        row = crud.get_plaza_submission(session=session, submission_id=sid)
        if not row:
            raise PlazaError("not_found", "Submission not found")
        row.custom_cover_image_url = url
        row.updated_at = now
        session.add(row)
        session.commit()
        session.refresh(row)
        return _row_to_meta(row.model_dump())


def _panel_urls_json_for_approve(
    *,
    submission_id: str,
    document: dict[str, Any] | None,
) -> str | None:
    from app.services.plaza.panel_png import generate_panel_png_urls

    panel_urls = generate_panel_png_urls(submission_id=submission_id, document=document)
    return json.dumps(panel_urls, ensure_ascii=False) if panel_urls else None


def approve_submission(submission_id: str, reviewer_id: str) -> dict[str, Any]:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_plaza_db()
    sid = _require_submission_id(submission_id)
    now = time.time()
    with Session(engine) as session:
        row = crud.get_plaza_submission(session=session, submission_id=sid)
        if not row:
            raise PlazaError("not_found", "Submission not found")
        dumped = row.model_dump()
        already = row.status == "approved"
        if already and _parse_panel_urls(dumped):
            return _row_to_meta(dumped)

        panel_raw = _panel_urls_json_for_approve(
            submission_id=str(row.id),
            document=_parse_document_json(row.document_json),
        )
        row.panel_urls_json = panel_raw
        row.updated_at = now
        if not already:
            row.status = "approved"
            row.reject_reason = None
            row.reviewed_at = now
            row.reviewed_by = reviewer_id
        session.add(row)
        session.commit()
        session.refresh(row)
        return _row_to_meta(row.model_dump())


def reject_submission(
    submission_id: str,
    reviewer_id: str,
    reason: str | None = None,
) -> dict[str, Any]:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_plaza_db()
    sid = _require_submission_id(submission_id)
    now = time.time()
    reason_text = (reason or "").strip()[:500] or None
    with Session(engine) as session:
        row = crud.get_plaza_submission(session=session, submission_id=sid)
        if not row:
            raise PlazaError("not_found", "Submission not found")
        row.status = "rejected"
        row.reject_reason = reason_text
        row.reviewed_at = now
        row.reviewed_by = reviewer_id
        row.updated_at = now
        session.add(row)
        session.commit()
        session.refresh(row)
        return _row_to_meta(row.model_dump())


def sync_like_count(submission_id: str, *, session: Any | None = None) -> int:
    """Recalculate like_count from plaza_likes; never below 0."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    sid = (submission_id or "").strip()
    if not sid:
        return 0
    if session is not None:
        return crud.sync_plaza_like_count(session=session, submission_id=sid)
    with Session(engine) as own:
        count = crud.sync_plaza_like_count(session=own, submission_id=sid)
        own.commit()
        return count


def increment_use_count(submission_id: str) -> int:
    """Atomically bump use_count; returns new value. Raises PlazaError if missing."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_plaza_db()
    sid = (submission_id or "").strip()
    if not sid:
        raise PlazaError("not_found", "Submission not found")
    with Session(engine) as session:
        row = crud.get_plaza_submission(session=session, submission_id=sid)
        if not row:
            raise PlazaError("not_found", "Submission not found")
        next_count = max(0, int(row.use_count or 0)) + 1
        row.use_count = next_count
        session.add(row)
        session.commit()
    return next_count


def delete_submission(submission_id: str) -> None:
    """Hard-delete a plaza submission and its likes."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_plaza_db()
    sid = _require_submission_id(submission_id)
    with Session(engine) as session:
        if not crud.delete_plaza_submission(session=session, submission_id=sid):
            raise PlazaError("not_found", "Submission not found")
