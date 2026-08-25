"""Per-user font upload limits and visibility."""

from __future__ import annotations

import pytest

from app.services import fonts_store


def _upsert_user_font(*, user_id: str, family: str, display_name: str | None = None) -> None:
    label = display_name or family
    fonts_store.upsert_font(
        family=family,
        display_name=label,
        children=[
            {
                "family": family,
                "displayName": label,
                "weight": 400,
                "url": f"https://example.com/{family}.woff2",
                "format": "woff2",
            }
        ],
        owner_user_id=user_id,
    )


def _cleanup_family(family: str) -> None:
    fonts_store.delete_font(family)


def test_assert_user_can_add_font_blocks_at_limit():
    uid = "user-font-limit-a"
    families = [f"TestFontLimitA{i}" for i in range(fonts_store.MAX_USER_FONTS)]
    try:
        for fam in families:
            _upsert_user_font(user_id=uid, family=fam)
        assert fonts_store.count_user_fonts(uid) == fonts_store.MAX_USER_FONTS
        with pytest.raises(ValueError, match="limit"):
            fonts_store.assert_user_can_add_font(uid, "TestFontLimitA_new")
    finally:
        for fam in families:
            _cleanup_family(fam)


def test_assert_user_can_add_font_allows_merge_existing_mine():
    uid = "user-font-merge-a"
    fam = "TestFontMergeA"
    try:
        _upsert_user_font(user_id=uid, family=fam)
        fonts_store.assert_user_can_add_font(uid, fam)
    finally:
        _cleanup_family(fam)


def test_resolve_upload_family_avoids_platform_collision():
    platform = "TestPlatformFontCollision"
    try:
        fonts_store.upsert_font(
            family=platform,
            display_name=platform,
            children=[
                {
                    "family": platform,
                    "displayName": "Regular",
                    "weight": 400,
                    "url": "https://example.com/platform.woff2",
                    "format": "woff2",
                }
            ],
            owner_user_id=None,
        )
        resolved = fonts_store.resolve_upload_family(platform, "user-collision-a")
        assert resolved != platform
        assert resolved.startswith(f"{platform}_")
    finally:
        _cleanup_family(platform)


def test_delete_user_font_only_own():
    owner = "user-font-delete-owner"
    other = "user-font-delete-other"
    fam = "TestFontDeleteMine"
    try:
        _upsert_user_font(user_id=owner, family=fam)
        assert not fonts_store.delete_user_font(user_id=other, family=fam)
        assert fonts_store.get_font_by_family(fam) is not None
        assert fonts_store.delete_user_font(user_id=owner, family=fam)
        assert fonts_store.get_font_by_family(fam) is None
    finally:
        _cleanup_family(fam)


def test_assert_unique_user_font_upload_rejects_duplicate_name():
    uid = "user-font-unique-name"
    fam = "TestFontUniqueName_abc123"
    label = "My Custom Font"
    try:
        _upsert_user_font(user_id=uid, family=fam, display_name=label)
        with pytest.raises(ValueError, match="name already exists"):
            fonts_store.assert_unique_user_font_upload(
                uid,
                display_name=label,
                content_hash="hash-new-file",
                requested_family="AnotherFamily",
            )
    finally:
        _cleanup_family(fam)


def test_assert_unique_user_font_upload_rejects_duplicate_hash():
    uid = "user-font-unique-hash"
    fam = "TestFontUniqueHash"
    digest = "abc123deadbeef"
    try:
        fonts_store.upsert_font(
            family=fam,
            display_name=fam,
            children=[
                {
                    "family": fam,
                    "displayName": "Regular",
                    "weight": 400,
                    "url": "https://example.com/hash.woff2",
                    "format": "woff2",
                    "contentHash": digest,
                }
            ],
            owner_user_id=uid,
        )
        with pytest.raises(ValueError, match="already uploaded"):
            fonts_store.assert_unique_user_font_upload(
                uid,
                display_name="Different Label",
                content_hash=digest,
                requested_family="DifferentFamily",
            )
    finally:
        _cleanup_family(fam)


def test_find_user_font_by_content_hash():
    uid = "user-font-hash"
    fam = "TestFontHash"
    digest = "abc123deadbeef"
    try:
        fonts_store.upsert_font(
            family=fam,
            display_name=fam,
            children=[
                {
                    "family": fam,
                    "displayName": "Regular",
                    "weight": 400,
                    "url": "https://example.com/hash.woff2",
                    "format": "woff2",
                    "contentHash": digest,
                }
            ],
            owner_user_id=uid,
        )
        hit = fonts_store.find_user_font_by_content_hash(uid, digest)
        assert hit is not None
        assert hit["family"] == fam
    finally:
        _cleanup_family(fam)


def test_list_fonts_hides_other_users_fonts():
    owner = "user-font-visibility-owner"
    viewer = "user-font-visibility-viewer"
    mine = "TestFontVisibleMine"
    hidden = "TestFontVisibleHidden"
    try:
        _upsert_user_font(user_id=viewer, family=mine)
        _upsert_user_font(user_id=owner, family=hidden)
        data = fonts_store.list_fonts(page=1, page_size=500, viewer_user_id=viewer)
        families = {it["family"] for it in data["items"]}
        assert mine in families
        assert hidden not in families
        mine_items = [it for it in data["items"] if it.get("isMine")]
        assert any(it["family"] == mine for it in mine_items)
    finally:
        _cleanup_family(mine)
        _cleanup_family(hidden)
