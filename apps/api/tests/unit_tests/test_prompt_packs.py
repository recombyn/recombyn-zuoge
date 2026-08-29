from app.services.design.prompts.skill_store import format_skills_details


def test_playbooks_live_in_design_skills_packs():
    from app.services.design.prompts.skill_store import (
        _SEED as _SKILL_SEED,
        _load_file_skills,
        ensure_design_skills,
        reset_skills_ready_for_tests,
    )

    reset_skills_ready_for_tests()
    ensure_design_skills(force=True)
    assert _SKILL_SEED == []
    keys = {str(p.get("skill_key") or "") for p in _load_file_skills()}
    assert "poster_craft" in keys
    assert "image_gen" in keys
    assert "vision_extract" not in keys
    assert "canvas_edit" not in keys
    assert "frontend_ui" not in keys
    details = format_skills_details(keys=["poster_craft", "image_gen"], scene="website")
    assert "skill: poster_craft" in details or "poster_craft" in details


def test_ensure_prompt_packs_resyncs_body_from_seed(monkeypatch):
    """Re-running ensure overwrites DB body with git seed (seed is source of truth)."""
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine
    from app.services.design.prompts import prompt_pack_store as pps

    pps._PACKS_READY = False
    try:
        pps.ensure_design_prompt_packs()
        with Session(engine) as session:
            rows = crud.list_all_design_prompt_packs(session=session)
            assert rows
            target = rows[0]
            kind = target.kind
            seed_body = str(
                (pps._SEED_BY_KIND.get(kind) or {}).get("body") or ""
            )
            assert seed_body.strip()
            target.body = "ADMIN_EDITED_BODY_SHOULD_BE_OVERWRITTEN"
            session.add(target)
            session.commit()

        pps._PACKS_READY = False
        pps.ensure_design_prompt_packs()
        with Session(engine) as session:
            again = crud.list_design_prompt_packs_by_kind(session=session, kind=kind)
            assert again
            assert again[0].body.replace("\r\n", "\n").strip() == seed_body.replace(
                "\r\n", "\n"
            ).strip()
    finally:
        pps._PACKS_READY = False


def test_oss_ask_system_seed_documents_choice_ui():
    from app.services.design.prompts.prompt_pack_store import _SEED_BY_KIND

    body = str((_SEED_BY_KIND.get("agent.prompt.ask_system") or {}).get("body") or "")
    assert "choice_ui" in body
    assert "apply" in body and "dismiss" in body
    assert "提案确认" in body or "Propose / confirm" in body or "Propose canvas work" in body
    assert "问法策略" in body or "Ask strategy" in body
    assert "每轮只问" in body or "One blocking question" in body
