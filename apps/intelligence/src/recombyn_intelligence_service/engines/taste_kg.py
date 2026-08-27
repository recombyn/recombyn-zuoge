"""Taste / KG store — seed principles + runtime append.

Persistence is local JSON under ``INTELLIGENCE_TASTE_DIR``
(default: ``<repo>/data/taste``).

Retrieval backends (same-file):
- hashed-ngram-v1 — default / offline floor
- openai-compatible-v1 — optional ``POST {base}/embeddings`` via env
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.request
import uuid
from pathlib import Path
from typing import Any


# Deterministic taste seeds.
_SEED: dict[str, list[dict[str, Any]]] = {
    "ai_landing": [
        {
            "id": "seed_ai_editorial",
            "text": (
                "taste:ai_landing:editorial_not_glow — editorial asymmetry; "
                "no purple gradient / glass / glow orbs"
            ),
            "tags": ["anti_glow", "editorial", "premium"],
            "weight": 1.0,
        },
        {
            "id": "seed_ai_metaphor",
            "text": (
                "taste:ai_landing:single_metaphor — one product metaphor beats "
                "a feature-card wall"
            ),
            "tags": ["composition", "product"],
            "weight": 0.9,
        },
        {
            "id": "seed_ai_palette",
            "text": (
                "taste:ai_landing:warm_neutral_one_accent — warm neutrals + "
                "one electric accent"
            ),
            "tags": ["color", "premium"],
            "weight": 0.85,
        },
    ],
    "poster": [
        {
            "id": "seed_poster_hero",
            "text": (
                "taste:poster:hero_60_80 — single focal hero covers 60–80% "
                "of the frame"
            ),
            "tags": ["hero", "hierarchy"],
            "weight": 1.0,
        },
        {
            "id": "seed_poster_thesis",
            "text": (
                "taste:poster:one_thesis_space — one thesis, clear type "
                "hierarchy, generous empty space"
            ),
            "tags": ["whitespace", "typography"],
            "weight": 0.9,
        },
        {
            "id": "seed_poster_no_collage",
            "text": (
                "taste:poster:no_postcard_collage — museum editorial, not "
                "multi-image collage"
            ),
            "tags": ["anti_slop", "editorial"],
            "weight": 0.85,
        },
    ],
    "dashboard": [
        {
            "id": "seed_dash_metric",
            "text": (
                "taste:dashboard:primary_metric_owns — one primary metric "
                "owns attention"
            ),
            "tags": ["hierarchy", "task"],
            "weight": 1.0,
        },
        {
            "id": "seed_dash_task",
            "text": (
                "taste:dashboard:task_first — task-first hierarchy; quiet "
                "secondary panels"
            ),
            "tags": ["layout", "task"],
            "weight": 0.9,
        },
        {
            "id": "seed_dash_kpi",
            "text": (
                "taste:dashboard:no_kpi_wall — charts only when they decide; "
                "actionable empty states"
            ),
            "tags": ["anti_slop", "data"],
            "weight": 0.85,
        },
    ],
    "landing": [
        {
            "id": "seed_landing_family",
            "text": (
                "taste:landing:section_family — related section family, not "
                "three equal cards"
            ),
            "tags": ["composition"],
            "weight": 0.9,
        },
        {
            "id": "seed_landing_cta",
            "text": (
                "taste:landing:one_cta — one decisive CTA; avoid rainbow "
                "CTA gradients"
            ),
            "tags": ["interaction", "anti_slop"],
            "weight": 0.85,
        },
    ],
    "generic": [
        {
            "id": "seed_generic_focal",
            "text": "taste:generic:one_focal — clear hierarchy with one focal idea",
            "tags": ["hierarchy"],
            "weight": 0.8,
        },
    ],
    # Niche overlays (private) — BasicLocal has no niche taste store.
    "seasonal_event": [
        {
            "id": "seed_event_motif",
            "text": (
                "taste:seasonal_event:one_motif — one event motif owns 60%+; "
                "no clipart collage"
            ),
            "tags": ["hero", "anti_slop", "event"],
            "weight": 1.0,
        },
        {
            "id": "seed_event_ink",
            "text": (
                "taste:seasonal_event:limited_ink — 2–3 ink palette; "
                "date/venue as secondary band"
            ),
            "tags": ["color", "typography"],
            "weight": 0.9,
        },
    ],
    "auth_ui": [
        {
            "id": "seed_auth_form",
            "text": (
                "taste:auth_ui:form_first — form-first hierarchy; "
                "one primary submit; no stock photo wall"
            ),
            "tags": ["ux", "hierarchy"],
            "weight": 1.0,
        },
    ],
    "type_specimen": [
        {
            "id": "seed_type_contrast",
            "text": (
                "taste:type_specimen:display_contrast — letterforms are the hero; "
                "protect tracking air"
            ),
            "tags": ["typography", "whitespace"],
            "weight": 1.0,
        },
    ],
    "ecommerce": [
        {
            "id": "seed_ecom_buy",
            "text": (
                "taste:ecommerce:one_buy_path — product hero + one buy CTA; "
                "mute badge noise"
            ),
            "tags": ["conversion", "product"],
            "weight": 1.0,
        },
    ],
}

_CATEGORY_HINTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("ai_landing", ("ai", "saas", "llm", "gpt", "大模型", "人工智能")),
    ("poster", ("海报", "poster", "kv", "易拉宝")),
    ("dashboard", ("dashboard", "后台", "控制台", "kpi", "看板")),
    ("landing", ("landing", "官网", "营销页", "落地页")),
    ("seasonal_event", ("halloween", "万圣节", "圣诞", "christmas", "春节", "concert", "演唱会")),
    ("auth_ui", ("登录", "login", "sign in", "signup", "注册页", "auth")),
    ("type_specimen", ("字体", "type specimen", "字样", "typography poster")),
    ("ecommerce", ("电商", "商品页", "pdp", "add to cart", "购买")),
)


def detect_category(prompt: str = "", scene_key: str = "") -> str:
    text = str(prompt or "")
    low = text.lower()
    for cat, hints in _CATEGORY_HINTS:
        if any(h.lower() in low or h in text for h in hints):
            return cat
    scene = str(scene_key or "").strip().lower()
    if "poster" in scene:
        return "poster"
    if "dashboard" in scene:
        return "dashboard"
    if "landing" in scene or "website" in scene:
        if "ai" in low or "saas" in low:
            return "ai_landing"
        return "landing"
    return "generic"


def _taste_dir() -> Path:
    raw = str(os.environ.get("INTELLIGENCE_TASTE_DIR") or "").strip()
    if raw:
        path = Path(raw).expanduser()
    else:
        path = Path(__file__).resolve().parents[3] / "data" / "taste"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _runtime_path() -> Path:
    return _taste_dir() / "runtime_kg.json"


def _empty_runtime() -> dict[str, Any]:
    return {"version": 1, "principles": [], "triples": []}


def load_runtime() -> dict[str, Any]:
    path = _runtime_path()
    if not path.is_file():
        return _empty_runtime()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return _empty_runtime()
    if not isinstance(data, dict):
        return _empty_runtime()
    data.setdefault("principles", [])
    data.setdefault("triples", [])
    return data


def save_runtime(data: dict[str, Any]) -> None:
    path = _runtime_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    tmp.replace(path)


def _seed_rows(category: str, niches: list[str] | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _add(batch: list[dict[str, Any]]) -> None:
        for row in batch:
            pid = str(row.get("id") or "")
            if pid and pid in seen:
                continue
            if pid:
                seen.add(pid)
            rows.append(row)

    _add(list(_SEED.get(category) or []))
    for niche in list(niches or []):
        _add(list(_SEED.get(niche) or []))
    if category != "generic":
        _add(list(_SEED.get("generic") or []))
    return rows


def _runtime_rows(category: str, niches: list[str] | None = None) -> list[dict[str, Any]]:
    data = load_runtime()
    allow = {category, "generic", "*", *(niches or [])}
    out: list[dict[str, Any]] = []
    for row in list(data.get("principles") or []):
        if not isinstance(row, dict):
            continue
        cat = str(row.get("category") or "generic")
        if cat in allow:
            out.append(row)
    return out


# ---------------------------------------------------------------------------
# Embeddings: hashed-ngram floor + optional OpenAI-compatible HTTP backend
# ---------------------------------------------------------------------------
_HASHED_DIM = 256
_HASHED_RETRIEVAL = "hashed-ngram-v1"
_OPENAI_RETRIEVAL = "openai-compatible-v1"

# Process-local seed vector cache: (backend, model, principle_id) -> vec
_SEED_VEC_CACHE: dict[tuple[str, str, str], list[float]] = {}


def _env(name: str, default: str = "") -> str:
    return str(os.environ.get(name) or default).strip()


def _embedding_base_url() -> str:
    raw = _env("INTELLIGENCE_EMBEDDING_BASE_URL") or _env(
        "INTELLIGENCE_EMBEDDING_URL"
    )
    return raw.rstrip("/")


def _embedding_api_key() -> str:
    return _env("INTELLIGENCE_EMBEDDING_API_KEY") or _env("OPENAI_API_KEY")


def _embedding_model() -> str:
    return _env("INTELLIGENCE_EMBEDDING_MODEL", "text-embedding-3-small")


def _embedding_timeout_sec() -> float:
    try:
        return float(_env("INTELLIGENCE_EMBEDDING_TIMEOUT_SEC", "20") or 20)
    except ValueError:
        return 20.0


def resolve_embedding_backend() -> str:
    """Return ``hashed`` or ``openai``. ``auto`` → openai when URL+key present."""
    raw = _env("INTELLIGENCE_EMBEDDING_BACKEND", "auto").lower()
    if raw in ("hashed", "hash", "ngram", "local"):
        return "hashed"
    if raw in ("openai", "http", "remote", "api"):
        return "openai"
    # auto
    if _embedding_base_url() and _embedding_api_key():
        return "openai"
    return "hashed"


def _tokenize(text: str) -> list[str]:
    raw = str(text or "").lower()
    toks = re.findall(r"[a-z0-9\u4e00-\u9fff]{2,}", raw)
    bigrams: list[str] = []
    compact = re.sub(r"\s+", "", raw)
    for i in range(max(0, len(compact) - 1)):
        pair = compact[i : i + 2]
        if re.fullmatch(r"[a-z0-9\u4e00-\u9fff]{2}", pair):
            bigrams.append(f"bg:{pair}")
    return toks + bigrams


def _stable_bucket(token: str) -> int:
    digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big") % _HASHED_DIM


def _l2_normalize(vec: list[float]) -> list[float]:
    norm = sum(v * v for v in vec) ** 0.5
    if norm <= 1e-12:
        return list(vec)
    return [v / norm for v in vec]


def hashed_embed_text(text: str) -> list[float]:
    """Unit-normalized hashed bag-of-n-grams vector (dim=_HASHED_DIM)."""
    vec = [0.0] * _HASHED_DIM
    for tok in _tokenize(text):
        vec[_stable_bucket(tok)] += 1.0
    return _l2_normalize(vec)


def cosine_sim(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    return float(sum(x * y for x, y in zip(a, b)))


def _openai_embed_batch(texts: list[str]) -> list[list[float]] | None:
    """POST OpenAI-compatible ``/embeddings``. Returns None on any failure."""
    clean = [str(t or "")[:8000] for t in texts]
    if not clean:
        return []
    base = _embedding_base_url()
    key = _embedding_api_key()
    model = _embedding_model()
    if not base or not key:
        return None
    url = f"{base}/embeddings" if not base.endswith("/embeddings") else base
    body = json.dumps({"model": model, "input": clean}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=_embedding_timeout_sec()) as res:
            payload = json.loads(res.read().decode("utf-8"))
    except Exception:
        return None
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list) or len(data) != len(clean):
        return None
    out: list[list[float]] = []
    # API may return unordered index — sort by index.
    ordered = sorted(
        (row for row in data if isinstance(row, dict)),
        key=lambda r: int(r.get("index") or 0),
    )
    if len(ordered) != len(clean):
        return None
    for row in ordered:
        emb = row.get("embedding")
        if not isinstance(emb, list) or not emb:
            return None
        try:
            out.append(_l2_normalize([float(x) for x in emb]))
        except (TypeError, ValueError):
            return None
    return out


# Test hook — replace to fake remote embeddings without network.
_openai_embed_batch_impl = _openai_embed_batch


def embed_texts(texts: list[str]) -> tuple[list[list[float]], str, int]:
    """Embed many strings. Returns (vectors, retrieval_id, dim). Always succeeds."""
    backend = resolve_embedding_backend()
    if backend == "openai":
        got = _openai_embed_batch_impl(list(texts))
        if got is not None and len(got) == len(texts):
            dim = len(got[0]) if got and got[0] else 0
            return got, _OPENAI_RETRIEVAL, dim
    vectors = [hashed_embed_text(t) for t in texts]
    return vectors, _HASHED_RETRIEVAL, _HASHED_DIM


def embed_text(text: str) -> list[float]:
    """Embed one string via active backend (falls back to hashed)."""
    vecs, _, _ = embed_texts([text])
    return vecs[0] if vecs else hashed_embed_text(text)


def _row_embed_text(row: dict[str, Any]) -> str:
    text = str(row.get("text") or "")
    tags = " ".join(str(t) for t in list(row.get("tags") or []))
    return f"{text} {tags}".strip()


def _cached_row_vec(
    row: dict[str, Any],
    *,
    retrieval: str,
    model: str,
) -> list[float] | None:
    blob = row.get("embedding")
    if not isinstance(blob, dict):
        return None
    if str(blob.get("retrieval") or "") != retrieval:
        return None
    if retrieval == _OPENAI_RETRIEVAL and str(blob.get("model") or "") != model:
        return None
    vec = blob.get("vec")
    if not isinstance(vec, list) or not vec:
        return None
    try:
        return [float(x) for x in vec]
    except (TypeError, ValueError):
        return None


def _attach_embedding(
    row: dict[str, Any],
    vec: list[float],
    *,
    retrieval: str,
    model: str,
) -> None:
    row["embedding"] = {
        "retrieval": retrieval,
        "model": model if retrieval == _OPENAI_RETRIEVAL else _HASHED_RETRIEVAL,
        "dim": len(vec),
        "vec": vec,
    }


def _score_from_sim(weight: float, sim: float, prompt: str, row: dict[str, Any]) -> float:
    text = str(row.get("text") or "").lower()
    tags = [str(t).lower() for t in list(row.get("tags") or [])]
    bump = 0.0
    for token in re.findall(r"[a-z\u4e00-\u9fff]{2,}", prompt.lower()):
        if token in text or any(token in t for t in tags):
            bump += 0.04
    return (0.35 * weight) + (0.55 * sim) + min(0.25, bump)


def _ensure_row_vectors(
    rows: list[dict[str, Any]],
    *,
    retrieval: str,
    model: str,
) -> tuple[list[list[float]], bool, str]:
    """Return (vectors, dirty_runtime, actual_retrieval_used)."""
    vectors: list[list[float] | None] = [None] * len(rows)
    miss_idx: list[int] = []
    miss_texts: list[str] = []

    for i, row in enumerate(rows):
        pid = str(row.get("id") or "")
        cached = _cached_row_vec(row, retrieval=retrieval, model=model)
        if cached is not None:
            vectors[i] = cached
            continue
        if pid.startswith("seed_"):
            key = (retrieval, model, pid)
            if key in _SEED_VEC_CACHE:
                vectors[i] = _SEED_VEC_CACHE[key]
                continue
        miss_idx.append(i)
        miss_texts.append(_row_embed_text(row))

    dirty = False
    used = retrieval
    if miss_texts:
        filled: list[list[float]] | None = None
        if retrieval == _OPENAI_RETRIEVAL:
            filled = _openai_embed_batch_impl(miss_texts)
        if filled is None or len(filled) != len(miss_texts):
            filled = [hashed_embed_text(t) for t in miss_texts]
            used = _HASHED_RETRIEVAL
            # Cache/model mismatch with openai query → caller must unify.
        else:
            used = _OPENAI_RETRIEVAL

        for j, idx in enumerate(miss_idx):
            vec = filled[j]
            vectors[idx] = vec
            row = rows[idx]
            pid = str(row.get("id") or "")
            cache_model = model if used == _OPENAI_RETRIEVAL else _HASHED_RETRIEVAL
            if pid.startswith("seed_"):
                _SEED_VEC_CACHE[(used, cache_model, pid)] = vec
            else:
                _attach_embedding(row, vec, retrieval=used, model=model)
                dirty = True

    # If any cached vector has wrong dim vs the misses we just filled, unify later.
    out: list[list[float]] = []
    for v in vectors:
        out.append(v if v is not None else hashed_embed_text(""))
    return out, dirty, used


def _related_triples(category: str, principle_ids: list[str], limit: int = 8) -> list[dict[str, str]]:
    data = load_runtime()
    id_set = {str(x) for x in principle_ids if str(x)}
    out: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for raw in list(data.get("triples") or []):
        if not isinstance(raw, dict):
            continue
        s = str(raw.get("s") or "")
        p = str(raw.get("p") or "")
        o = str(raw.get("o") or "")
        if not (s and p and o):
            continue
        if s not in id_set and o not in id_set and s != category and o != category:
            continue
        key = (s, p, o)
        if key in seen:
            continue
        seen.add(key)
        out.append({"s": s[:80], "p": p[:40], "o": o[:160]})
        if len(out) >= limit:
            break
    return out


def search_taste(
    *,
    prompt: str = "",
    scene_key: str = "",
    category: str | None = None,
    niches: list[str] | None = None,
    limit: int = 8,
) -> dict[str, Any]:
    """Retrieve seed + runtime taste via active embedding backend (+ hashed fallback)."""
    cat = str(category or "").strip() or detect_category(prompt, scene_key)
    niche_list = [str(x) for x in list(niches or []) if str(x).strip()][:4]
    # If category is already a niche key, keep it and still blend sibling seeds.
    backend = resolve_embedding_backend()
    model = _embedding_model()
    query_text = prompt or scene_key or cat
    if niche_list:
        query_text = f"{query_text} niches:{','.join(niche_list)}"

    query_vecs, used_retrieval, embed_dim = embed_texts([query_text])
    query_vec = query_vecs[0]

    rows = _seed_rows(cat, niche_list) + _runtime_rows(cat, niche_list)
    row_vecs, dirty, row_retrieval = _ensure_row_vectors(
        rows, retrieval=used_retrieval, model=model
    )

    # Keep query + rows on one geometry (never mix openai dim with hashed).
    if (
        row_retrieval != used_retrieval
        or any(len(v) != len(query_vec) for v in row_vecs)
    ):
        used_retrieval = _HASHED_RETRIEVAL
        embed_dim = _HASHED_DIM
        query_vec = hashed_embed_text(query_text)
        row_vecs = [hashed_embed_text(_row_embed_text(r)) for r in rows]
        dirty = False

    if dirty:
        data = load_runtime()
        by_id = {
            str(r.get("id") or ""): r
            for r in list(data.get("principles") or [])
            if isinstance(r, dict)
        }
        for row in rows:
            pid = str(row.get("id") or "")
            if pid.startswith("seed_") or pid not in by_id:
                continue
            if isinstance(row.get("embedding"), dict):
                by_id[pid]["embedding"] = row["embedding"]
        save_runtime(data)

    scored: list[tuple[float, dict[str, Any]]] = []
    for row, vec in zip(rows, row_vecs):
        sim = cosine_sim(query_vec, vec)
        weight = float(row.get("weight") or 0.5)
        scored.append((_score_from_sim(weight, sim, prompt, row), row))
    scored.sort(key=lambda pair: pair[0], reverse=True)

    notes: list[str] = []
    principles: list[str] = []
    ids: list[str] = []
    scores: list[float] = []
    hits: list[dict[str, Any]] = []
    for score, row in scored:
        text = str(row.get("text") or "").strip()
        if not text or text in notes:
            continue
        pid = str(row.get("id") or "").strip()
        notes.append(text[:120])
        principles.append(text[:160])
        if pid:
            ids.append(pid)
        scores.append(round(float(score), 4))
        hits.append(
            {
                "id": pid,
                "score": round(float(score), 4),
                "text": text[:120],
                "source": str(
                    row.get("source")
                    or ("seed" if pid.startswith("seed_") else "runtime")
                ),
            }
        )
        if len(notes) >= limit:
            break

    related = _related_triples(cat, ids, limit=8)
    prefs = {
        "premium": any("premium" in n.lower() for n in notes),
        "anti_glow": any(
            "glow" in n.lower() or "editorial_not_glow" in n for n in notes
        ),
        "whitespace": any(
            "whitespace" in n.lower()
            or "empty space" in n.lower()
            or "留白" in n
            for n in notes
        ),
    }
    _ = backend
    return {
        "category": cat,
        "niches": niche_list,
        "notes": notes[:16],
        "principles": principles[:12],
        "ids": ids[:12],
        "scores": scores[:12],
        "hits": hits[:12],
        "related_triples": related,
        "preferences": prefs,
        "retrieval": used_retrieval,
        "embed_dim": embed_dim or len(query_vec),
        "embed_backend": "openai" if used_retrieval == _OPENAI_RETRIEVAL else "hashed",
        "embed_model": model if used_retrieval == _OPENAI_RETRIEVAL else None,
        "store": "private-taste-kg",
        "private_signals": {
            "stage": "taste_retrieve",
            "provider_tier": "private",
            "niches": niche_list,
            "category": cat,
        },
        "summary": (
            f"taste category={cat} niches={','.join(niche_list) or '-'} "
            f"notes={len(notes)} retrieval={used_retrieval} triples={len(related)}"
        ),
    }


def _triple(subject: str, predicate: str, obj: str) -> dict[str, str]:
    return {"s": subject[:80], "p": predicate[:40], "o": obj[:160]}


def write_principles(
    principles: list[str],
    *,
    category: str = "generic",
    prompt: str = "",
    source: str = "run",
) -> dict[str, Any]:
    """Append principles + SPO triples to runtime KG. Idempotent on text."""
    clean = [str(x).strip()[:160] for x in principles if str(x).strip()]
    if not clean:
        return {
            "principles": [],
            "written": False,
            "ids": [],
            "store": "private-taste-kg",
            "summary": "wrote 0 principles",
        }

    cat = str(category or "generic").strip() or "generic"
    data = load_runtime()
    existing_text = {
        str(r.get("text") or "").strip()
        for r in list(data.get("principles") or [])
        if isinstance(r, dict)
    }
    ids: list[str] = []
    written_rows = 0
    now = time.time()
    new_rows: list[dict[str, Any]] = []
    for text in clean:
        if text in existing_text:
            data.setdefault("triples", []).append(_triple(cat, "recalls", text))
            continue
        pid = f"p_{uuid.uuid4().hex[:10]}"
        row = {
            "id": pid,
            "category": cat,
            "text": text,
            "tags": ["runtime", source],
            "weight": 0.75,
            "source": source,
            "prompt_echo": str(prompt or "")[:80],
            "created_at": now,
        }
        data.setdefault("principles", []).append(row)
        new_rows.append(row)
        data.setdefault("triples", []).append(_triple(cat, "has_principle", text))
        data.setdefault("triples", []).append(_triple(pid, "about", cat))
        ids.append(pid)
        existing_text.add(text)
        written_rows += 1

    if new_rows:
        vecs, retrieval, _dim = embed_texts([_row_embed_text(r) for r in new_rows])
        model = _embedding_model()
        for row, vec in zip(new_rows, vecs):
            _attach_embedding(row, vec, retrieval=retrieval, model=model)

    data["principles"] = list(data.get("principles") or [])[-400:]
    data["triples"] = list(data.get("triples") or [])[-2000:]
    save_runtime(data)
    return {
        "principles": clean[:12],
        "written": True,
        "ids": ids,
        "added": written_rows,
        "store": "private-taste-kg",
        "summary": f"wrote {written_rows} new / {len(clean)} total · category={cat}",
    }


def reset_runtime_for_tests() -> None:
    """Test helper — wipe runtime KG file + seed vector cache."""
    path = _runtime_path()
    if path.is_file():
        path.unlink()
    _SEED_VEC_CACHE.clear()


# Back-compat aliases used by older tests / callers
_EMBED_DIM = _HASHED_DIM
_RETRIEVAL = _HASHED_RETRIEVAL
