# -*- coding: utf-8 -*-
"""Validate design_agent_eval_suite.json shape + skill_expect keys exist on disk."""
from __future__ import annotations

import json

from app.core.config import api_seeds_dir


def _suite() -> dict:
    path = api_seeds_dir() / "design_agent_eval_suite.json"
    assert path.is_file(), f"missing eval suite: {path}"
    return json.loads(path.read_text(encoding="utf-8"))


def _skill_dirs() -> set[str]:
    from app.services.design.prompts.skill_store.pack_io import _file_skills_dirs

    out: set[str] = set()
    for root in _file_skills_dirs():
        for p in root.iterdir():
            if p.is_dir() and (p / "SKILL.md").is_file():
                out.add(p.name)
    return out


def test_eval_suite_cases_shape():
    suite = _suite()
    assert int(suite.get("version") or 0) >= 2
    cases = suite.get("cases") or []
    assert len(cases) >= 5
    seen: set[str] = set()
    for c in cases:
        cid = str(c.get("id") or "").strip()
        assert cid, c
        assert cid not in seen, cid
        seen.add(cid)
        assert str(c.get("prompt") or "").strip(), cid
        expect = c.get("skill_expect") or []
        assert isinstance(expect, list) and expect, cid
        for k in expect:
            assert isinstance(k, str) and k.strip(), cid


def test_eval_suite_system_cases_shape():
    suite = _suite()
    system = suite.get("system_cases") or []
    assert len(system) >= 3
    seen: set[str] = set()
    for c in system:
        cid = str(c.get("id") or "").strip()
        assert cid, c
        assert cid not in seen, cid
        seen.add(cid)
        assert str(c.get("prompt") or "").strip(), cid
        assert str(c.get("focus") or "").strip(), cid
        expect = c.get("expect") or []
        assert isinstance(expect, list) and expect, cid


def test_eval_suite_skill_expect_exist_on_disk():
    skills = _skill_dirs()
    assert skills, "design_skills packs missing"
    suite = _suite()
    missing: list[str] = []
    for c in suite.get("cases") or []:
        for k in c.get("skill_expect") or []:
            if k not in skills:
                missing.append(f"{c.get('id')}:{k}")
    assert not missing, f"skill_expect not found under skills catalog: {missing}"



def test_eval_suite_ids_unique_across_pools():
    suite = _suite()
    ids = [c["id"] for c in (suite.get("cases") or [])] + [
        c["id"] for c in (suite.get("system_cases") or [])
    ] + [c["id"] for c in (suite.get("agent_cases") or [])]
    assert len(ids) == len(set(ids))


def test_eval_suite_agent_cases_cover_transport_and_recovery_contracts():
    suite = _suite()
    cases = suite.get("agent_cases") or []
    assert len(cases) >= 4
    required = {"agent_receipt_missing", "agent_reconnect_ack", "agent_ambiguous_edit", "agent_worker_resume"}
    assert {str(case.get("id") or "") for case in cases} >= required
    for case in cases:
        assert str(case.get("focus") or "").strip()
        assert isinstance(case.get("expect"), list) and case["expect"]
