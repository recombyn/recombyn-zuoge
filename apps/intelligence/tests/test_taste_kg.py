"""Taste / KG persistence + hashed / OpenAI-compatible embedding retrieval."""

from __future__ import annotations

import json
from pathlib import Path

import recombyn_intelligence_service.engines.taste_kg as taste_kg
from recombyn_intelligence_service.engines.taste_kg import (
    cosine_sim,
    embed_text,
    hashed_embed_text,
    reset_runtime_for_tests,
    resolve_embedding_backend,
    search_taste,
    write_principles,
)
from recombyn_intelligence_service.providers import handle_method


def _force_hashed(monkeypatch) -> None:
    monkeypatch.setenv("INTELLIGENCE_EMBEDDING_BACKEND", "hashed")
    monkeypatch.delenv("INTELLIGENCE_EMBEDDING_BASE_URL", raising=False)
    monkeypatch.delenv("INTELLIGENCE_EMBEDDING_URL", raising=False)
    monkeypatch.delenv("INTELLIGENCE_EMBEDDING_API_KEY", raising=False)


def _fake_openai_batch(texts: list[str]) -> list[list[float]]:
    """Deterministic 8-d vectors — keyword axes, no network."""
    out: list[list[float]] = []
    for text in texts:
        low = str(text).lower()
        vec = [0.05] * 8
        if any(k in low for k in ("whitespace", "留白", "empty space", "empty")):
            vec[0] = 1.0
        if any(k in low for k in ("glow", "purple", "editorial_not_glow")):
            vec[1] = 1.0
        if "hero" in low:
            vec[2] = 1.0
        if any(k in low for k in ("premium", "高级", "museum", "relic")):
            vec[3] = 1.0
        if "poster" in low or "海报" in low:
            vec[4] = 0.8
        if "kpi" in low or "dashboard" in low:
            vec[5] = 1.0
        norm = sum(v * v for v in vec) ** 0.5
        out.append([v / norm for v in vec])
    return out


def test_taste_kg_seed_retrieve_and_write(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("INTELLIGENCE_TASTE_DIR", str(tmp_path))
    _force_hashed(monkeypatch)
    reset_runtime_for_tests()

    hit = search_taste(prompt="AI SaaS landing 不要千篇一律", scene_key="website")
    assert hit["category"] == "ai_landing"
    assert any("editorial_not_glow" in n or "glow" in n for n in hit["notes"])
    assert hit["store"] == "private-taste-kg"
    assert hit["retrieval"] == "hashed-ngram-v1"
    assert hit["embed_backend"] == "hashed"
    assert hit["scores"]
    assert hit["hits"]

    written = write_principles(
        ["thesis:editorial product", "research:avoid: purple gradient"],
        category="ai_landing",
        prompt="AI landing",
    )
    assert written["written"] is True
    assert written["added"] >= 1
    assert (tmp_path / "runtime_kg.json").is_file()
    stored = json.loads((tmp_path / "runtime_kg.json").read_text(encoding="utf-8"))
    assert any(
        isinstance(r, dict) and isinstance(r.get("embedding"), dict)
        for r in stored.get("principles") or []
    )

    again = search_taste(prompt="AI landing premium", scene_key="website")
    joined = " ".join(again["notes"])
    assert "thesis:editorial product" in joined or "purple" in joined
    assert again.get("related_triples") is not None


def test_embedding_ranks_whitespace_query_above_unrelated(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("INTELLIGENCE_TASTE_DIR", str(tmp_path))
    _force_hashed(monkeypatch)
    reset_runtime_for_tests()

    hit = search_taste(
        prompt="海报要大量留白 whitespace museum empty space",
        scene_key="poster",
        category="poster",
        limit=6,
    )
    assert hit["retrieval"] == "hashed-ngram-v1"
    assert hit["embed_dim"] == 256
    assert len(hit["scores"]) == len(hit["notes"])
    blob = " ".join(hit["notes"]).lower()
    assert "whitespace" in blob or "empty space" in blob or "thesis" in blob
    scores = list(hit["scores"])
    assert scores == sorted(scores, reverse=True)

    a = hashed_embed_text("generous empty space whitespace")
    b = hashed_embed_text("generous empty space whitespace")
    c = hashed_embed_text("kpi chart dashboard metrics wall")
    assert cosine_sim(a, b) > 0.99
    assert cosine_sim(a, c) < cosine_sim(a, b)


def test_openai_compatible_backend_via_mock(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("INTELLIGENCE_TASTE_DIR", str(tmp_path))
    monkeypatch.setenv("INTELLIGENCE_EMBEDDING_BACKEND", "openai")
    monkeypatch.setenv("INTELLIGENCE_EMBEDDING_BASE_URL", "https://example.invalid/v1")
    monkeypatch.setenv("INTELLIGENCE_EMBEDDING_API_KEY", "test-key")
    monkeypatch.setenv("INTELLIGENCE_EMBEDDING_MODEL", "text-embedding-3-small")
    reset_runtime_for_tests()
    monkeypatch.setattr(taste_kg, "_openai_embed_batch_impl", _fake_openai_batch)

    assert resolve_embedding_backend() == "openai"

    hit = search_taste(
        prompt="海报大量留白 whitespace empty space",
        scene_key="poster",
        category="poster",
        limit=5,
    )
    assert hit["retrieval"] == "openai-compatible-v1"
    assert hit["embed_backend"] == "openai"
    assert hit["embed_model"] == "text-embedding-3-small"
    assert hit["embed_dim"] == 8
    blob = " ".join(hit["notes"]).lower()
    assert "whitespace" in blob or "empty space" in blob or "thesis" in blob

    written = write_principles(
        ["thesis:museum relic sword"],
        category="poster",
        prompt="武侠海报",
    )
    assert written["written"] is True
    stored = json.loads((tmp_path / "runtime_kg.json").read_text(encoding="utf-8"))
    emb = (stored["principles"][0].get("embedding") or {})
    assert emb.get("retrieval") == "openai-compatible-v1"
    assert len(emb.get("vec") or []) == 8

    mem = handle_method(
        "retrieve_memory",
        {"prompt": "museum relic 海报", "scene_key": "poster", "flags": {}},
    )
    assert mem.get("embed_backend") == "openai"
    assert "museum relic" in " ".join(mem.get("notes") or [])


def test_openai_failure_falls_back_to_hashed(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("INTELLIGENCE_TASTE_DIR", str(tmp_path))
    monkeypatch.setenv("INTELLIGENCE_EMBEDDING_BACKEND", "openai")
    monkeypatch.setenv("INTELLIGENCE_EMBEDDING_BASE_URL", "https://example.invalid/v1")
    monkeypatch.setenv("INTELLIGENCE_EMBEDDING_API_KEY", "test-key")
    reset_runtime_for_tests()
    monkeypatch.setattr(taste_kg, "_openai_embed_batch_impl", lambda _texts: None)

    hit = search_taste(prompt="海报留白", scene_key="poster")
    assert hit["retrieval"] == "hashed-ngram-v1"
    assert hit["embed_backend"] == "hashed"
    assert hit["embed_dim"] == 256


def test_auto_backend_without_keys_is_hashed(monkeypatch):
    monkeypatch.setenv("INTELLIGENCE_EMBEDDING_BACKEND", "auto")
    monkeypatch.delenv("INTELLIGENCE_EMBEDDING_BASE_URL", raising=False)
    monkeypatch.delenv("INTELLIGENCE_EMBEDDING_URL", raising=False)
    monkeypatch.delenv("INTELLIGENCE_EMBEDDING_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert resolve_embedding_backend() == "hashed"


def test_retrieve_and_write_via_provider(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("INTELLIGENCE_TASTE_DIR", str(tmp_path))
    _force_hashed(monkeypatch)
    reset_runtime_for_tests()

    mem = handle_method(
        "retrieve_memory",
        {
            "prompt": "做一个高级科技感海报",
            "scene_key": "poster",
            "flags": {},
        },
    )
    assert mem.get("provider") == "private-memory"
    assert mem.get("store") == "private-taste-kg"
    assert mem.get("category") == "poster"
    assert mem.get("retrieval") == "hashed-ngram-v1"
    assert isinstance(mem.get("scores"), list)
    assert isinstance(mem.get("hits"), list)
    assert any("hero" in n.lower() or "poster" in n.lower() for n in mem.get("notes") or [])

    out = handle_method(
        "write_principle",
        {
            "prompt": "海报",
            "scene_key": "poster",
            "design_strategy": {"visual_thesis": "museum relic sword"},
            "design_research": {
                "category": "poster",
                "anti_category_strategy": ["avoid: particles"],
            },
            "design_governance": {"status": "pass"},
            "flags": {},
        },
    )
    assert out.get("written") is True
    assert out.get("store") == "private-taste-kg"
    assert out.get("ids")

    mem2 = handle_method(
        "retrieve_memory",
        {"prompt": "武侠海报", "scene_key": "poster", "flags": {}},
    )
    blob = " ".join(mem2.get("notes") or [])
    assert "museum relic" in blob or "particles" in blob or "thesis:" in blob
    assert isinstance(mem2.get("related_triples"), list)
    assert mem2.get("related_triples")
    assert len(embed_text("x")) == 256
