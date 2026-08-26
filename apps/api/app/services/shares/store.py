"""Document shares — preview/edit links with collaborator / viewer ACL."""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.services.db import init_schema

_MAX_DOC_BYTES = 12 * 1024 * 1024
_PERMISSIONS = frozenset({"preview", "download", "edit"})


class ShareError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _parse_user_ids(raw: Any) -> list[str]:
    if raw is None or raw == "":
        return []
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, json.JSONDecodeError):
        return []
    if not isinstance(data, list):
        return []
    return [str(x).strip() for x in data if str(x).strip()]


def _normalize_user_ids(ids: list[str] | None, *, owner_id: str) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for uid in ids or []:
        u = str(uid or "").strip()
        if not u or u == owner_id or u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out[:40]


def _col(row: Any, name: str, default: Any = None) -> Any:
    if hasattr(row, name):
        val = getattr(row, name)
        return default if val is None else val
    try:
        if name not in row.keys():
            return default
    except Exception:
        return default
    val = row[name]
    return default if val is None else val


def _get(row: Any, name: str, default: Any = None) -> Any:
    return _col(row, name, default)


def _link_enabled(row: Any) -> bool:
    val = _col(row, "link_enabled", 1)
    return bool(int(val))


def _link_public(row: Any) -> bool:
    """Anyone with the link may preview when True (and link is enabled)."""
    val = _col(row, "link_public", 0)
    return bool(int(val))


def actor_can_edit_share(row: Any, *, actor_user_id: str | None) -> bool:
    """Open full editor only for edit links (owner or listed collaborator).

    Preview / download links stay on the share viewer — including when the owner
    opens their own view link to verify it.
    """
    actor = (actor_user_id or "").strip()
    if not actor:
        return False
    perm = str(_get(row, "permission") or "preview").strip().lower()
    if perm != "edit":
        return False
    owner_id = str(_get(row, "owner_id") or "")
    if actor == owner_id:
        return True
    editors = _parse_user_ids(_col(row, "editor_user_ids"))
    return actor in editors


def actor_can_view_share(row: Any, *, actor_user_id: str | None) -> bool:
    """
    Preview access:
    - owner always
    - listed editors / viewers when signed in
    - anyone when link_enabled + link_public
    """
    if not _link_enabled(row):
        actor = (actor_user_id or "").strip()
        owner_id = str(_get(row, "owner_id") or "")
        return bool(actor and actor == owner_id)

    owner_id = str(_get(row, "owner_id") or "")
    actor = (actor_user_id or "").strip()
    if actor and actor == owner_id:
        return True
    if actor:
        editors = _parse_user_ids(_col(row, "editor_user_ids"))
        viewers = _parse_user_ids(_col(row, "viewer_user_ids"))
        if actor in editors or actor in viewers:
            return True
    if _link_public(row):
        return True
    return False


def actor_can_update_document(row: Any, *, actor_user_id: str | None) -> bool:
    """Owner may always refresh the shared snapshot; collaborators when edit ACL allows."""
    actor = (actor_user_id or "").strip()
    if not actor:
        return False
    owner_id = str(_get(row, "owner_id") or "")
    if actor == owner_id:
        return True
    return actor_can_edit_share(row, actor_user_id=actor)


def _snapshot_document_from_row(row: Any) -> dict[str, Any] | None:
    try:
        doc = json.loads(_get(row, "document_json"))
        return doc if isinstance(doc, dict) else None
    except (TypeError, json.JSONDecodeError):
        return None


def _live_document_from_source_project(row: Any) -> dict[str, Any] | None:
    """Prefer the owner's live project doc over a stale share snapshot."""
    src = str(_col(row, "source_project_id") or "").strip()
    owner_id = str(_get(row, "owner_id") or "").strip()
    if not src or not owner_id:
        return None
    # Local import avoids circular services.projects ↔ shares at module load.
    from app.services.projects import get_project

    proj = get_project(owner_id, src)
    if not proj:
        return None
    doc = proj.get("document")
    return doc if isinstance(doc, dict) else None


def _row_to_share(
    row: Any,
    *,
    include_document: bool = True,
    actor_user_id: str | None = None,
) -> dict[str, Any]:
    editors = _parse_user_ids(_col(row, "editor_user_ids"))
    viewers = _parse_user_ids(_col(row, "viewer_user_ids"))
    can_view = actor_can_view_share(row, actor_user_id=actor_user_id)
    out: dict[str, Any] = {
        "id": _get(row, "id"),
        "ownerId": _get(row, "owner_id"),
        "name": _get(row, "name"),
        "permission": _get(row, "permission"),
        "editorUserIds": editors,
        "viewerUserIds": viewers,
        "linkEnabled": _link_enabled(row),
        "linkPublic": _link_public(row),
        "sourceProjectId": _get(row, "source_project_id"),
        "createdAt": int(float(_get(row, "created_at") or 0) * 1000),
        "updatedAt": int(float(_get(row, "updated_at") or 0) * 1000),
        "viewerCanView": can_view,
        "viewerCanEdit": actor_can_edit_share(row, actor_user_id=actor_user_id),
    }
    if include_document:
        if can_view:
            # Linked shares track the live project; fall back to frozen snapshot.
            out["document"] = _live_document_from_source_project(row) or _snapshot_document_from_row(
                row
            )
        else:
            out["document"] = None
    return out


def _clamp_share_title(name: str | None, *, fallback: str = "Untitled") -> str:
    title = (name or "").strip() or fallback
    return title[:255] if len(title) > 255 else title


def _encode_document_json(
    document: dict[str, Any],
    *,
    too_large_message: str = "Document is too large to share",
) -> str:
    raw = json.dumps(document, ensure_ascii=False, separators=(",", ":"))
    if len(raw.encode("utf-8")) > _MAX_DOC_BYTES:
        raise ShareError("document_too_large", too_large_message)
    return raw


def _should_keep_existing_acl(
    editor_user_ids: list[str] | None,
    viewer_user_ids: list[str] | None,
) -> bool:
    """Empty ACL from Share dialog open = preserve prior collaborators."""
    return not (editor_user_ids or []) and not (viewer_user_ids or [])


def _reuse_share_acl_fields(
    existing: Any,
    *,
    keep_acl: bool,
    perm: str,
    editors: list[str],
    viewers: list[str],
    public: int,
) -> tuple[str, str, str, int]:
    if keep_acl:
        return (
            str(_get(existing, "permission") or "preview"),
            json.dumps(_parse_user_ids(_col(existing, "editor_user_ids")), ensure_ascii=False),
            json.dumps(_parse_user_ids(_col(existing, "viewer_user_ids")), ensure_ascii=False),
            int(_col(existing, "link_public", 0) or 0),
        )
    return (
        perm,
        json.dumps(editors, ensure_ascii=False),
        json.dumps(viewers, ensure_ascii=False),
        public,
    )


def create_share(
    *,
    owner_id: str,
    name: str,
    permission: str,
    document: dict[str, Any] | None,
    source_project_id: str | None = None,
    editor_user_ids: list[str] | None = None,
    viewer_user_ids: list[str] | None = None,
    link_public: bool | None = None,
) -> dict[str, Any]:
    """Create a share link, or reuse the latest share for the same project.

    Opening the Share dialog always hits this endpoint with empty collaborator
    lists — when ``source_project_id`` matches an existing row for this owner,
    refresh the document snapshot and keep ACL / link settings.
    """
    init_schema()
    uid = (owner_id or "").strip()
    if not uid:
        raise ShareError("invalid_owner", "owner is required")
    perm = (permission or "preview").strip().lower()
    if perm not in _PERMISSIONS:
        raise ShareError(
            "invalid_permission", "permission must be preview, download, or edit"
        )
    src = (source_project_id or "").strip() or None
    doc_obj: dict[str, Any] | None = document if isinstance(document, dict) else None
    if not doc_obj or not doc_obj.keys():
        if src:
            from app.services.projects import get_project

            proj = get_project(uid, src)
            loaded = proj.get("document") if isinstance(proj, dict) else None
            if isinstance(loaded, dict):
                doc_obj = loaded
        if not doc_obj:
            raise ShareError("invalid_document", "document must be an object")
    title = _clamp_share_title(name)
    raw = _encode_document_json(doc_obj)
    editors = _normalize_user_ids(editor_user_ids, owner_id=uid) if perm == "edit" else []
    viewers = _normalize_user_ids(viewer_user_ids, owner_id=uid)
    # Default restricted (invited only). Public preview when explicitly enabled.
    public = 1 if link_public else 0
    now = time.time()

    with Session(engine) as session:
        if src:
            existing = crud.find_document_share_by_project(
                session=session, owner_id=uid, source_project_id=src
            )
            if existing:
                next_perm, next_editors, next_viewers, next_public = _reuse_share_acl_fields(
                    existing,
                    keep_acl=_should_keep_existing_acl(editor_user_ids, viewer_user_ids),
                    perm=perm,
                    editors=editors,
                    viewers=viewers,
                    public=public,
                )
                # Fast open: empty client document → keep stored snapshot; caller syncs via PUT.
                next_doc_json = raw
                if isinstance(document, dict) and not document.keys():
                    next_doc_json = str(_get(existing, "document_json") or raw)
                row = crud.upsert_document_share(
                    session=session,
                    share_id=str(existing.id),
                    owner_id=uid,
                    name=title,
                    permission=next_perm,
                    document_json=next_doc_json,
                    source_project_id=src,
                    editor_user_ids=next_editors,
                    viewer_user_ids=next_viewers,
                    link_enabled=1 if _link_enabled(existing) else 0,
                    link_public=next_public,
                )
                return _row_to_share(row, actor_user_id=uid)

        sid = f"share_{uuid.uuid4().hex[:16]}"
        row = crud.upsert_document_share(
            session=session,
            share_id=sid,
            owner_id=uid,
            name=title,
            permission=perm,
            document_json=raw,
            source_project_id=src,
            editor_user_ids=json.dumps(editors, ensure_ascii=False),
            viewer_user_ids=json.dumps(viewers, ensure_ascii=False),
            link_enabled=1,
            link_public=public,
            created_at=now,
        )
        return _row_to_share(row, actor_user_id=uid)


def get_share(
    share_id: str,
    *,
    actor_user_id: str | None = None,
    allow_disabled_for_owner: bool = True,
) -> dict[str, Any] | None:
    init_schema()
    sid = (share_id or "").strip()
    if not sid:
        return None
    with Session(engine) as session:
        row = crud.get_document_share(session=session, share_id=sid)
    if not row:
        return None
    actor = (actor_user_id or "").strip()
    owner_id = str(_get(row, "owner_id") or "")
    if not _link_enabled(row):
        if not (allow_disabled_for_owner and actor and actor == owner_id):
            return None
    return _row_to_share(row, actor_user_id=actor_user_id)


def _resolve_meta_editors(
    row: Any,
    *,
    owner_id: str,
    editor_user_ids: list[str] | None,
    perm: str,
) -> list[str]:
    if editor_user_ids is None:
        editors = _parse_user_ids(_col(row, "editor_user_ids"))
    else:
        editors = _normalize_user_ids(editor_user_ids, owner_id=owner_id)
    return [] if perm != "edit" else editors


def _resolve_meta_viewers(
    row: Any,
    *,
    owner_id: str,
    viewer_user_ids: list[str] | None,
    editors: list[str],
) -> list[str]:
    if viewer_user_ids is None:
        viewers = _parse_user_ids(_col(row, "viewer_user_ids"))
    else:
        viewers = _normalize_user_ids(viewer_user_ids, owner_id=owner_id)
    editors_set = set(editors)
    return [v for v in viewers if v not in editors_set]


def update_share_meta(
    share_id: str,
    *,
    actor_user_id: str,
    permission: str | None = None,
    editor_user_ids: list[str] | None = None,
    viewer_user_ids: list[str] | None = None,
    name: str | None = None,
    link_enabled: bool | None = None,
    link_public: bool | None = None,
) -> dict[str, Any]:
    """Owner-only: update link permission / collaborator lists."""
    init_schema()
    sid = (share_id or "").strip()
    actor = (actor_user_id or "").strip()
    if not sid:
        raise ShareError("not_found", "Share not found")
    if not actor:
        raise ShareError("unauthorized", "Sign in required")
    with Session(engine) as session:
        row = crud.get_document_share(session=session, share_id=sid)
        if not row:
            raise ShareError("not_found", "Share not found")
        owner_id = str(_get(row, "owner_id") or "")
        if actor != owner_id:
            raise ShareError("forbidden", "Only the owner can manage this share")
        perm = (permission or _get(row, "permission") or "preview").strip().lower()
        if perm not in _PERMISSIONS:
            raise ShareError(
                "invalid_permission", "permission must be preview, download, or edit"
            )
        editors = _resolve_meta_editors(
            row, owner_id=owner_id, editor_user_ids=editor_user_ids, perm=perm
        )
        viewers = _resolve_meta_viewers(
            row, owner_id=owner_id, viewer_user_ids=viewer_user_ids, editors=editors
        )
        title = str(_get(row, "name") or "Untitled")
        if name is not None:
            title = _clamp_share_title(name)
        enabled = 1 if _link_enabled(row) else 0
        if link_enabled is not None:
            enabled = 1 if link_enabled else 0
        public = 1 if _link_public(row) else 0
        if link_public is not None:
            public = 1 if link_public else 0
        saved = crud.update_document_share_fields(
            session=session,
            share_id=sid,
            fields={
                "permission": perm,
                "editor_user_ids": json.dumps(editors, ensure_ascii=False),
                "viewer_user_ids": json.dumps(viewers, ensure_ascii=False),
                "name": title,
                "link_enabled": enabled,
                "link_public": public,
            },
        )
    if not saved:
        raise ShareError("not_found", "Share not found")
    return _row_to_share(saved, actor_user_id=actor)


def update_share_document(
    share_id: str,
    document: dict[str, Any],
    *,
    actor_user_id: str | None = None,
) -> dict[str, Any]:
    """Update shared document (owner always; collaborators when edit ACL allows)."""
    init_schema()
    sid = (share_id or "").strip()
    if not sid:
        raise ShareError("not_found", "Share not found")
    if not isinstance(document, dict):
        raise ShareError("invalid_document", "document must be an object")
    raw = _encode_document_json(document, too_large_message="Document is too large")
    with Session(engine) as session:
        row = crud.get_document_share(session=session, share_id=sid)
        if not row:
            raise ShareError("not_found", "Share not found")
        if not actor_can_update_document(row, actor_user_id=actor_user_id):
            actor = (actor_user_id or "").strip()
            if not actor:
                raise ShareError("unauthorized", "Sign in required to edit this share")
            raise ShareError("forbidden", "You do not have edit access to this share")
        saved = crud.update_document_share_fields(
            session=session,
            share_id=sid,
            fields={"document_json": raw},
        )
    if not saved:
        raise ShareError("not_found", "Share not found")
    return _row_to_share(saved, actor_user_id=actor_user_id or "")


def sync_project_share_documents(
    *,
    owner_id: str,
    project_id: str,
    document: dict[str, Any],
) -> int:
    """Keep linked share snapshots warm when the source project is saved.

    Preview GET already prefers the live project doc; this keeps document_json
    useful for offline readers.
    """
    uid = (owner_id or "").strip()
    pid = (project_id or "").strip()
    if not uid or not pid or not isinstance(document, dict):
        return 0
    try:
        raw = _encode_document_json(document, too_large_message="Document is too large")
    except ShareError:
        return 0
    init_schema()
    with Session(engine) as session:
        return crud.sync_document_shares_for_project(
            session=session,
            owner_id=uid,
            project_id=pid,
            document_json=raw,
        )
