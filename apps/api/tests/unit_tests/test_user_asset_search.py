# -*- coding: utf-8 -*-
from __future__ import annotations

import time
import uuid

from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.models import Asset


def _seed_assets(session: Session, *, user_id: str, prefix: str) -> None:
    now = time.time()
    rows = [
        Asset(
            id=f"{prefix}-dog",
            user_id=user_id,
            kind="image",
            object_key=f"assets/{user_id}/dog.png",
            url="https://cdn.example/dog.png",
            source="ai_image",
            prompt="穿卫衣的小狗",
            created_at=now,
        ),
        Asset(
            id=f"{prefix}-landscape",
            user_id=user_id,
            kind="image",
            object_key=f"assets/{user_id}/hill.jpg",
            url="https://cdn.example/hill.jpg",
            source="ai_image",
            prompt="风景",
            created_at=now - 1,
        ),
        Asset(
            id=f"{prefix}-meta-noise",
            user_id=user_id,
            kind="lottie",
            object_key=f"assets/{user_id}/asset_c9f72bf76efd4d5a.json",
            url="https://cdn.example/anim.json",
            source="ai_lottie",
            prompt="动效",
            # Base64-like blob that would false-positive on LIKE/contains("%sxas%").
            meta_json='{"animation":{"data":"AAAAAsxasBBBB"}}',
            created_at=now - 2,
        ),
        Asset(
            id=f"{prefix}-other-user",
            user_id=f"{user_id}-other",
            kind="image",
            object_key=f"assets/{user_id}-other/cat.png",
            url="https://cdn.example/cat.png",
            source="ai_image",
            prompt="小狗",
            created_at=now,
        ),
    ]
    for row in rows:
        session.add(row)
    session.commit()


def test_user_asset_search_filters_prompt_and_object_key():
    prefix = f"uas-{uuid.uuid4().hex[:10]}"
    user_id = f"u-{prefix}"
    sources = ("ai_image", "ai_video", "ai_audio", "ai_lottie")
    seeded_ids = [
        f"{prefix}-dog",
        f"{prefix}-landscape",
        f"{prefix}-meta-noise",
        f"{prefix}-other-user",
    ]

    with Session(engine) as session:
        _seed_assets(session, user_id=user_id, prefix=prefix)
        try:
            assert (
                crud.count_user_assets(session=session, user_id=user_id, sources=sources, q="狗")
                == 1
            )
            assert (
                crud.count_user_assets(session=session, user_id=user_id, sources=sources, q="hill")
                == 1
            )
            assert (
                crud.count_user_assets(session=session, user_id=user_id, sources=sources, q="手")
                == 0
            )
            assert (
                crud.count_user_assets(
                    session=session, user_id=user_id, sources=sources, q="枸杞铁盒"
                )
                == 0
            )
            assert (
                crud.list_user_assets(
                    session=session,
                    user_id=user_id,
                    sources=sources,
                    q="枸杞铁盒",
                    limit=10,
                )
                == []
            )
            # Short alphanumeric must NOT match meta_json base64 noise.
            assert (
                crud.count_user_assets(session=session, user_id=user_id, sources=sources, q="sxas")
                == 0
            )
            # Single hex letter must NOT match every UUID object_key.
            assert (
                crud.count_user_assets(session=session, user_id=user_id, sources=sources, q="a")
                == 0
            )
            # LIKE wildcards in the query are literal under INSTR.
            assert (
                crud.count_user_assets(session=session, user_id=user_id, sources=sources, q="%")
                == 0
            )
            matched = crud.list_user_assets(
                session=session,
                user_id=user_id,
                sources=sources,
                q="狗",
                limit=10,
            )
            assert [row.id for row in matched] == [f"{prefix}-dog"]
        finally:
            for aid in seeded_ids:
                row = session.get(Asset, aid)
                if row is not None:
                    session.delete(row)
            session.commit()
