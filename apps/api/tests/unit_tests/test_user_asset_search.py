# -*- coding: utf-8 -*-
from __future__ import annotations

import time

from sqlmodel import Session, SQLModel, create_engine

from app import crud
from app.models import Asset


def _seed_assets(session: Session) -> None:
    now = time.time()
    rows = [
        Asset(
            id="asset-dog",
            user_id="u1",
            kind="image",
            object_key="assets/u1/dog.png",
            url="https://cdn.example/dog.png",
            source="ai_image",
            prompt="穿卫衣的小狗",
            created_at=now,
        ),
        Asset(
            id="asset-landscape",
            user_id="u1",
            kind="image",
            object_key="assets/u1/hill.jpg",
            url="https://cdn.example/hill.jpg",
            source="ai_image",
            prompt="风景",
            created_at=now - 1,
        ),
        Asset(
            id="asset-other-user",
            user_id="u2",
            kind="image",
            object_key="assets/u2/cat.png",
            url="https://cdn.example/cat.png",
            source="ai_image",
            prompt="小狗",
            created_at=now,
        ),
    ]
    for row in rows:
        session.add(row)
    session.commit()


def test_user_asset_search_filters_prompt_and_object_key(tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'assets.db').as_posix()}")
    SQLModel.metadata.create_all(engine)
    sources = ("ai_image", "ai_video", "ai_audio", "ai_lottie")

    with Session(engine) as session:
        _seed_assets(session)
        assert (
            crud.count_user_assets(session=session, user_id="u1", sources=sources, q="狗")
            == 1
        )
        assert (
            crud.count_user_assets(session=session, user_id="u1", sources=sources, q="hill")
            == 1
        )
        assert (
            crud.count_user_assets(session=session, user_id="u1", sources=sources, q="手")
            == 0
        )
        matched = crud.list_user_assets(
            session=session,
            user_id="u1",
            sources=sources,
            q="狗",
            limit=10,
        )
        assert [row.id for row in matched] == ["asset-dog"]
