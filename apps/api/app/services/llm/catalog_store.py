"""LLM model catalog — DB rows + seed JSON for ensure/seed only."""
from __future__ import annotations

import json
import time
from typing import Any

from app.core.config import resolve_seed_file
from app.services.db import init_schema

# Where a model may appear in Agent route slots / admin model routes.
# - text: simple / medium / complex
# - vision: multimodal slot; also allowed in text slots ("usable anywhere" except image)
# - image: image-gen slot only
REFERENCE_TYPES = ('text', 'vision', 'image', 'video', 'audio')


def _load_catalog_seed() -> dict[str, Any]:
    """Load llm_models_seed.json (models + presets + tombstones)."""
    try:
        parsed = json.loads(resolve_seed_file("llm_models_seed.json").read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


_SEED_DOC = _load_catalog_seed()


def _load_image_limit_presets() -> dict[str, dict[str, Any]]:
    raw = _SEED_DOC.get("imageLimitPresets") or {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for k, v in raw.items():
        if isinstance(v, dict):
            out[str(k)] = v
    return out


def _load_model_seed() -> list[dict[str, Any]]:
    raw = _SEED_DOC.get("models") or []
    if not isinstance(raw, list):
        return []
    return [x for x in raw if isinstance(x, dict) and str(x.get("id") or "").strip()]


# apps/api/seeds/llm_models_seed.json
IMAGE_LIMIT_PRESETS: dict[str, dict[str, Any]] = _load_image_limit_presets()
_SEED: list[dict[str, Any]] = _load_model_seed()


def _normalize_reference_types(raw: Any, *, kind: str = 'text') -> list[str]:
    """Normalize admin/API payload into ordered unique reference types."""
    items: list[str] = []
    if isinstance(raw, str):
        s = raw.strip()
        if s.startswith('['):
            try:
                raw = json.loads(s)
            except Exception:
                raw = [p.strip() for p in s.split(',') if p.strip()]
        else:
            raw = [p.strip() for p in s.replace('|', ',').split(',') if p.strip()]
    if isinstance(raw, (list, tuple, set)):
        for x in raw:
            t = str(x or '').strip().lower()
            if t in REFERENCE_TYPES and t not in items:
                items.append(t)
    if items:
        return items
    # Defaults when unset
    kind_n = (kind or 'text').strip().lower()
    if kind_n == 'image':
        return ['image']
    if kind_n == 'video':
        return ['video']
    if kind_n == 'audio':
        return ['audio']
    return ['text']


IMAGE_LIMIT_PRESET_LABELS: dict[str, str] = {
    'seedream_5_pro': 'Seedream 5.0 Pro（方舟官方）',
    'seedream_5_lite': 'Seedream 5.0 Lite（方舟官方）',
    'seedream_4_5': 'Seedream 4.5（方舟官方）',
    'seedream_4_0': 'Seedream 4.0（方舟官方）',
    'openrouter_image': 'OpenRouter 通用生图（Images API）',
    'openrouter_gemini_image': 'OpenRouter Gemini 生图（chat modalities）',
    'openrouter_gpt_image': 'OpenRouter GPT Image（Images API）',
}


def infer_image_limit_preset(
    model_id: str | None = None,
    api_model: str | None = None,
    *,
    provider: str | None = None,
) -> str | None:
    """Map catalog model ids → IMAGE_LIMIT_PRESETS key."""
    blob = f'{model_id or ""} {api_model or ""}'.lower()
    prov = (provider or '').strip().lower()
    if 'seedream-5-0-pro' in blob or 'seedream_5_0_pro' in blob:
        return 'seedream_5_pro'
    if 'seedream-5-0-lite' in blob or 'seedream_5_0_lite' in blob:
        return 'seedream_5_lite'
    # Lite api_model is often `doubao-seedream-5-0-260128` (no "lite" token).
    if (
        ('seedream-5-0' in blob or 'seedream_5_0' in blob)
        and 'pro' not in blob
    ):
        return 'seedream_5_lite'
    if 'seedream-4-5' in blob or 'seedream_4_5' in blob:
        return 'seedream_4_5'
    if 'seedream-4-0' in blob or 'seedream_4_0' in blob:
        return 'seedream_4_0'
    if prov == 'openrouter' or 'openrouter' in blob or blob.strip().startswith('or-'):
        if 'gpt-image' in blob or 'gpt_image' in blob:
            return 'openrouter_gpt_image'
        if 'gemini' in blob or 'banana' in blob:
            return 'openrouter_gemini_image'
        if 'image' in blob:
            return 'openrouter_image'
    return None


def resolve_image_limits(raw: Any = None, *, preset: str | None = None) -> dict[str, Any] | None:
    """Normalize image_limits from inline dict, JSON string, or named preset."""
    if isinstance(raw, str) and raw.strip():
        try:
            raw = json.loads(raw)
        except Exception:
            raw = None
    if isinstance(raw, dict) and raw:
        nested = str(raw.get('preset') or '').strip()
        # Thin pointer `{ "preset": "seedream_5_lite" }` → expand full contract.
        if nested in IMAGE_LIMIT_PRESETS and not any(
            k in raw for k in ('min_pixels', 'max_pixels', 'resolutions', 'size_tables')
        ):
            out = dict(IMAGE_LIMIT_PRESETS[nested])
            out['preset'] = nested
            return out
        out: dict[str, Any] = {}
        if nested:
            out['preset'] = nested
        for key in ('min_pixels', 'max_pixels'):
            if raw.get(key) is not None:
                try:
                    out[key] = int(raw[key])
                except (TypeError, ValueError):
                    pass
        res = raw.get('resolutions')
        if isinstance(res, list):
            out['resolutions'] = [
                str(x).strip().upper() for x in res if str(x).strip()
            ]
        dr = raw.get('default_resolution')
        if dr:
            out['default_resolution'] = str(dr).strip().upper()
        if 'supports_output_format' in raw:
            out['supports_output_format'] = bool(raw.get('supports_output_format'))
        if 'supports_quality' in raw:
            out['supports_quality'] = bool(raw.get('supports_quality'))
        transport = raw.get('transport')
        if transport:
            out['transport'] = str(transport).strip().lower()
        aspects = raw.get('aspect_ratios')
        if isinstance(aspects, list):
            out['aspect_ratios'] = [
                str(x).strip() for x in aspects if str(x).strip()
            ]
        tables = raw.get('size_tables')
        if isinstance(tables, dict) and tables:
            cleaned: dict[str, dict[str, str]] = {}
            for rk, mapping in tables.items():
                if not isinstance(mapping, dict):
                    continue
                cleaned[str(rk).strip().upper()] = {
                    str(ak).strip(): str(av).strip()
                    for ak, av in mapping.items()
                    if str(ak).strip() and str(av).strip()
                }
            if cleaned:
                out['size_tables'] = cleaned
        # Expand from nested preset when row only stored a partial override.
        if nested in IMAGE_LIMIT_PRESETS:
            base = dict(IMAGE_LIMIT_PRESETS[nested])
            base.update(out)
            base['preset'] = nested
            return base
        return out or None
    key = (preset or '').strip()
    if key in IMAGE_LIMIT_PRESETS:
        out = dict(IMAGE_LIMIT_PRESETS[key])
        out['preset'] = key
        return out
    return None


def _image_limits_for_seed(m: dict[str, Any]) -> dict[str, Any] | None:
    preset = str(m.get('image_limit_preset') or '') or None
    if not preset:
        preset = infer_image_limit_preset(
            str(m.get('id') or ''),
            str(m.get('api_model') or ''),
            provider=str(m.get('provider') or ''),
        )
    return resolve_image_limits(m.get('image_limits'), preset=preset)


def _serialize_image_limits(limits: dict[str, Any] | None) -> str | None:
    if not limits:
        return None
    # Persist each model's full contract (not a shared preset pointer).
    out = {k: v for k, v in limits.items() if k != 'preset' and v is not None}
    if not out:
        return None
    return json.dumps(out, ensure_ascii=False, separators=(',', ':'))


def list_image_limit_presets() -> list[dict[str, Any]]:
    """Admin helper templates only — fill form once; each model stores its own limits."""
    items: list[dict[str, Any]] = []
    for key, label in IMAGE_LIMIT_PRESET_LABELS.items():
        limits = resolve_image_limits(preset=key)
        if not limits:
            continue
        # Strip preset id so templates don't re-bind models to a shared pointer.
        payload = {k: v for k, v in limits.items() if k != 'preset'}
        items.append({'id': key, 'label': label, 'imageLimits': payload})
    return items


def _serialize_reference_types(types: list[str]) -> str:
    return json.dumps(types, ensure_ascii=False)


def _parse_reference_types_cell(raw: Any, *, kind: str = 'text') -> list[str]:
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return _normalize_reference_types(None, kind=kind)
    return _normalize_reference_types(raw, kind=kind)


def _default_reference_types_for_seed(m: dict[str, Any]) -> list[str]:
    return _normalize_reference_types(m.get('reference_types'), kind=str(m.get('kind') or 'text'))


def _heuristic_vision_id(model_id: str) -> bool:
    ref = (model_id or '').strip().lower()
    if not ref or 'seedream' in ref:
        return False
    if 'mini' in ref or 'flash' in ref:
        return False
    if ref in ('doubao-seed-2-1-pro', 'doubao-seed-2-1-turbo'):
        return True
    return any(m in ref for m in ('vision', 'seed-2-1-pro', 'seed-2-1-turbo', 'seed-2.1-pro', 'seed-2.1-turbo'))


_CATALOG_SEEDED = False


def ensure_llm_catalog_seed(*, force: bool = False) -> None:
    """Schema via Alembic; insert missing seed rows / retire dropped ids."""
    global _CATALOG_SEEDED
    if _CATALOG_SEEDED and not force:
        return
    from sqlmodel import Session

    from app.core.db import engine

    init_schema()
    with Session(engine) as session:
        _ensure_seed_models(session)
        _backfill_empty_reference_types(session)
        _retire_direct_deepseek_models(session)
        _drop_retired_seed_models(session)
        session.commit()
    try:
        apply_ark_reference_prices(only_empty=True)
    except Exception:
        pass
    _CATALOG_SEEDED = True


def apply_ark_reference_prices(
    conn: Any | None = None,
    *,
    only_empty: bool = True,
) -> dict[str, Any]:
    """Write curated reference prices into catalog rows.

    By default only fills empty ``price`` (boot-safe). Pass ``only_empty=False``
    for an explicit Admin sync that may overwrite.
    """
    from app.services.llm.ark_prices import ARK_REFERENCE_PRICES

    now = time.time()
    updated: list[str] = []
    skipped: list[str] = []

    def _run(c: Any) -> None:
        has_meta = True
        try:
            cols = {str(r['name']) for r in c.execute('PRAGMA table_info(llm_models)').fetchall()}
            has_meta = 'price_meta' in cols
        except Exception:
            # MySQL / drivers without PRAGMA — assume column exists after migrate.
            has_meta = True
        for mid, spec in ARK_REFERENCE_PRICES.items():
            row = c.execute(
                'SELECT id, price FROM llm_models WHERE id = ?',
                (mid,),
            ).fetchone()
            if not row:
                skipped.append(mid)
                continue
            try:
                cur_price = str(row['price'] or '').strip()
            except Exception:
                cur_price = ''
            if only_empty and cur_price:
                skipped.append(mid)
                continue
            price = str(spec.get('price') or '').strip()
            meta = spec.get('price_meta') if isinstance(spec.get('price_meta'), dict) else {}
            meta_json = json.dumps(
                {**meta, 'synced_at': int(now)},
                ensure_ascii=False,
                separators=(',', ':'),
            )
            if has_meta:
                c.execute(
                    """
                    UPDATE llm_models
                    SET price = ?, price_meta = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (price, meta_json, now, mid),
                )
            else:
                c.execute(
                    """
                    UPDATE llm_models
                    SET price = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (price, now, mid),
                )
            updated.append(mid)

    if conn is not None:
        _run(conn)
        return {
            'ok': True,
            'updated': updated,
            'skipped': skipped,
            'updated_count': len(updated),
            'only_empty': only_empty,
        }

    init_schema()
    from sqlmodel import Session

    from app.core.db import engine
    from app.models import LlmModel

    with Session(engine) as session:
        for mid, spec in ARK_REFERENCE_PRICES.items():
            row = session.get(LlmModel, mid)
            if not row:
                skipped.append(mid)
                continue
            cur_price = str(row.price or '').strip()
            if only_empty and cur_price:
                skipped.append(mid)
                continue
            price = str(spec.get('price') or '').strip()
            meta = spec.get('price_meta') if isinstance(spec.get('price_meta'), dict) else {}
            row.price = price
            row.price_meta = json.dumps(
                {**meta, 'synced_at': int(now)},
                ensure_ascii=False,
                separators=(',', ':'),
            )
            row.updated_at = now
            session.add(row)
            updated.append(mid)
        session.commit()
    return {
        'ok': True,
        'updated': updated,
        'skipped': skipped,
        'updated_count': len(updated),
        'source': 'ark_docs',
        'only_empty': only_empty,
    }


def _parse_price_meta(raw: Any) -> dict[str, Any] | None:
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            data = json.loads(raw)
        except Exception:
            return None
        return data if isinstance(data, dict) else None
    return None


def _backfill_empty_reference_types(session: Any) -> None:
    """Fill empty reference_types cells only (admin edits stick)."""
    from sqlmodel import select

    from app.models import LlmModel

    for r in session.exec(select(LlmModel)).all():
        raw = r.reference_types
        if raw is not None and str(raw).strip():
            continue
        mid = str(r.id or '')
        kind = str(r.kind or 'text')
        seed = next((m for m in _SEED if m['id'] == mid), None)
        if seed:
            types = _default_reference_types_for_seed(seed)
        else:
            kind_defaults = {
                'image': ['image'],
                'video': ['video'],
                'audio': ['audio'],
            }
            if kind in kind_defaults:
                types = kind_defaults[kind]
            elif _heuristic_vision_id(mid):
                types = ['text', 'vision']
            else:
                types = ['text']
        r.reference_types = _serialize_reference_types(types)
        session.add(r)


def _load_id_tuple(key: str) -> tuple[str, ...]:
    raw = _SEED_DOC.get(key) or []
    if not isinstance(raw, list):
        return ()
    return tuple(str(x) for x in raw if str(x).strip())


def _load_stale_descriptions() -> frozenset[str]:
    raw = _SEED_DOC.get("staleSeedDescriptions") or []
    if not isinstance(raw, list):
        return frozenset()
    return frozenset(str(x) for x in raw if str(x).strip())


_RETIRED_DIRECT_DEEPSEEK_IDS = _load_id_tuple("retiredDirectDeepseekIds")
# Dropped from catalog permanently (admin delete kept getting re-seeded).
_DROPPED_SEED_MODEL_IDS = _load_id_tuple("droppedSeedModelIds")
# Legacy seed blurbs that were kind-generic; refresh from current _SEED when still present.
_STALE_SEED_DESCRIPTIONS = _load_stale_descriptions()


def _retire_direct_deepseek_models(session: Any) -> None:
    """Disable models that call DeepSeek API directly."""
    from sqlmodel import col, or_, select

    from app.models import LlmModel

    now = time.time()
    retired = list(_RETIRED_DIRECT_DEEPSEEK_IDS)
    conds = [col(LlmModel.provider) == 'deepseek']
    if retired:
        conds.append(col(LlmModel.id).in_(retired))
    for r in session.exec(select(LlmModel).where(or_(*conds))).all():
        r.enabled = 0
        r.updated_at = now
        session.add(r)


def _drop_retired_seed_models(session: Any) -> None:
    """Hard-remove dropped seed ids and tombstone so they cannot come back."""
    if not _DROPPED_SEED_MODEL_IDS:
        return
    from app.models import LlmModel, LlmModelRemoved

    now = time.time()
    for mid in _DROPPED_SEED_MODEL_IDS:
        row = session.get(LlmModel, mid)
        if row:
            session.delete(row)
        tomb = session.get(LlmModelRemoved, mid)
        if tomb:
            tomb.removed_at = now
            session.add(tomb)
        else:
            session.add(LlmModelRemoved(id=mid, removed_at=now))


def _removed_seed_ids(session: Any) -> set[str]:
    from sqlmodel import select

    from app.models import LlmModelRemoved

    try:
        rows = list(session.exec(select(LlmModelRemoved)).all())
    except Exception:
        return set()
    return {str(r.id) for r in rows if r and r.id}


def _ensure_seed_models(session: Any) -> None:
    """Insert any missing official seed rows (does not overwrite admin edits).

    Skips ids tombstoned via admin delete (``llm_models_removed``).
    """
    from app.models import LlmModel

    now = time.time()
    removed = _removed_seed_ids(session)
    for m in _SEED:
        if m['id'] in removed:
            continue
        row = session.get(LlmModel, m['id'])
        seed_limits = _image_limits_for_seed(m)
        limits_json = _serialize_image_limits(seed_limits)
        if row:
            # Existing row is Admin-owned: only fill empty icon / description / limits.
            seed_api = str(m.get('api_model') or '').strip()
            cur_api = (row.api_model or '').strip()
            if seed_api and cur_api != seed_api and (not cur_api or cur_api == row.id):
                row.api_model = seed_api
                row.updated_at = now
                session.add(row)
            cur_icon = (row.icon_key or '').strip()
            if not cur_icon and m.get('icon_key'):
                row.icon_key = m['icon_key']
                row.updated_at = now
                session.add(row)
            cur_desc = (row.description or '').strip()
            if not cur_desc and m.get('description'):
                row.description = m['description']
                row.updated_at = now
                session.add(row)
            if limits_json:
                cur_lim = row.image_limits
                empty = cur_lim is None or (
                    isinstance(cur_lim, str) and not str(cur_lim).strip()
                )
                if empty:
                    row.image_limits = limits_json
                    row.max_attachments = int(m.get('max_attachments') or 14)
                    row.updated_at = now
                    session.add(row)
            continue
        ref_types = _serialize_reference_types(_default_reference_types_for_seed(m))
        session.add(
            LlmModel(
                id=m['id'],
                label=m['label'],
                description=m['description'],
                provider=m['provider'],
                kind=m['kind'],
                api_model=m['api_model'],
                icon_key=m['icon_key'],
                icon_url=None,
                price=m.get('price'),
                max_attachments=m['max_attachments'],
                thinking=m['thinking'],
                enabled=m['enabled'],
                sort_order=m['sort_order'],
                reference_types=ref_types,
                image_limits=limits_json,
                created_at=now,
                updated_at=now,
            )
        )


def _row_get(r: Any, name: str, default: Any = None) -> Any:
    if hasattr(r, name):
        val = getattr(r, name)
        return default if val is None else val
    try:
        keys = r.keys()
        if name not in keys:
            return default
    except Exception:
        return default
    val = r[name]
    return default if val is None else val


def _pub(r: Any) -> dict[str, Any]:
    price_raw = _row_get(r, 'price')
    kind = _row_get(r, 'kind') or 'text'
    ref_raw = _row_get(r, 'reference_types')
    ref_types = _parse_reference_types_cell(ref_raw, kind=kind)
    lim_raw = _row_get(r, 'image_limits')
    image_limits = resolve_image_limits(lim_raw)
    if not image_limits:
        inferred = infer_image_limit_preset(
            str(_row_get(r, 'id') or ''),
            str(_row_get(r, 'api_model') or ''),
            provider=str(_row_get(r, 'provider') or ''),
        )
        image_limits = resolve_image_limits(preset=inferred)
    meta_raw = _row_get(r, 'price_meta')
    price_meta = _parse_price_meta(meta_raw)
    created_at = _row_get(r, 'created_at')
    updated_at = _row_get(r, 'updated_at')
    return {
        'id': _row_get(r, 'id'),
        'label': _row_get(r, 'label'),
        'description': _row_get(r, 'description') or None,
        'provider': _row_get(r, 'provider') or 'doubao',
        'kind': kind,
        'referenceTypes': ref_types,
        'apiModel': _row_get(r, 'api_model'),
        'iconKey': _row_get(r, 'icon_key') or None,
        'iconUrl': _row_get(r, 'icon_url') or None,
        'price': (str(price_raw).strip() if price_raw else None),
        'priceMeta': price_meta,
        'pricingId': (_row_get(r, 'pricing_id') or None),
        'maxAttachments': int(_row_get(r, 'max_attachments') or 8),
        'thinking': bool(int(_row_get(r, 'thinking') or 0)),
        'enabled': bool(int(_row_get(r, 'enabled') or 0)),
        'sortOrder': int(_row_get(r, 'sort_order') or 100),
        'imageLimits': image_limits,
        'createdAt': int(float(created_at) * 1000) if created_at else None,
        'updatedAt': int(float(updated_at) * 1000) if updated_at else None,
    }


def list_catalog(*, kind: str | None = None, enabled_only: bool = True) -> list[dict[str, Any]]:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_llm_catalog_seed()
    with Session(engine) as session:
        rows = crud.list_llm_models(
            session=session, kind=kind, enabled_only=enabled_only
        )
    return [_pub(r) for r in rows]


def list_admin_models(*, kind: str | None = None, q: str | None = None) -> list[dict[str, Any]]:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_llm_catalog_seed()
    with Session(engine) as session:
        rows = crud.list_llm_models(session=session, kind=kind, q=q)
    return [_pub(r) for r in rows]


def get_model(model_id: str) -> dict[str, Any] | None:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    ensure_llm_catalog_seed()
    mid = (model_id or '').strip()
    if not mid:
        return None
    with Session(engine) as session:
        row = crud.get_llm_model(session=session, model_id=mid)
    return _pub(row) if row else None


def _seed_api_model(catalog_id: str) -> str | None:
    """Official seed ``api_model`` for a catalog id (None when unknown)."""
    mid = (catalog_id or '').strip()
    if not mid:
        return None
    for m in _SEED:
        if m.get('id') == mid:
            api = str(m.get('api_model') or '').strip()
            return api or None
    return None


def resolve_catalog_api_model(catalog_id: str) -> str:
    """Map catalog id → provider endpoint id (unfiltered by BYOK unlock).

    ``list_*_models`` may hide rows when a provider key is missing; generation
    must still resolve ``doubao-seedream-5-0-lite`` → ``doubao-seedream-5-0-260128``.
    """
    mid = (catalog_id or '').strip()
    if not mid:
        return ''
    seed_api = _seed_api_model(mid)
    row = get_model(mid)
    if row:
        api = str(row.get('apiModel') or '').strip()
        if api and api != mid:
            return api
    if seed_api:
        return seed_api
    return mid


def upsert_model(payload: dict[str, Any]) -> dict[str, Any]:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine
    from app.models import LlmModel

    ensure_llm_catalog_seed()
    mid = str(payload.get('id') or '').strip()
    if not mid:
        raise ValueError('id required')
    label = str(payload.get('label') or mid).strip()
    kind = str(payload.get('kind') or 'text').strip().lower()
    if kind not in ('text', 'image', 'video', 'audio'):
        raise ValueError('kind must be text|image|video|audio')
    ref_types = _normalize_reference_types(
        payload.get('referenceTypes'),
        kind=kind,
    )
    if kind == 'image' and 'image' not in ref_types:
        # Image-catalog models must be selectable for the image slot.
        ref_types = ['image', *[t for t in ref_types if t != 'image']]
    if kind == 'video' and 'video' not in ref_types:
        ref_types = ['video', *[t for t in ref_types if t != 'video']]
    if kind == 'audio' and 'audio' not in ref_types:
        ref_types = ['audio', *[t for t in ref_types if t != 'audio']]
    if kind == 'text' and ref_types == ['image']:
        raise ValueError('text models cannot be image-only; add text and/or vision')
    ref_types_json = _serialize_reference_types(ref_types)
    provider = str(payload.get('provider') or 'doubao').strip() or 'doubao'
    api_model = str(payload.get('apiModel') or mid).strip()
    description = payload.get('description')
    icon_key = payload.get('iconKey')
    icon_url = payload.get('iconUrl')
    price_raw = payload.get('price')
    price = (str(price_raw).strip() if price_raw is not None else '') or None
    pricing_id_raw = payload.get('pricingId')
    pricing_id = (str(pricing_id_raw).strip() if pricing_id_raw is not None else '') or None
    if not pricing_id:
        pricing_id = f'price:{mid}'
    max_attachments = int(payload.get('maxAttachments') or 8)
    thinking = 1 if payload.get('thinking') else 0
    enabled = 1 if payload.get('enabled', True) else 0
    sort_order = int(payload.get('sortOrder') or 100)
    limits_payload = payload.get('imageLimits')
    preset = payload.get('imageLimitPreset')
    if kind == 'image':
        image_limits = resolve_image_limits(limits_payload, preset=str(preset or '') or None)
    else:
        image_limits = None
    limits_json = _serialize_image_limits(image_limits)
    meta_in_payload = 'priceMeta' in payload
    meta_payload = payload.get('priceMeta')
    now = time.time()
    with Session(engine) as session:
        # Admin re-adding a previously deleted seed clears the tombstone.
        try:
            crud.clear_llm_model_removed(session=session, model_id=mid)
        except Exception:
            pass
        existing = crud.get_llm_model(session=session, model_id=mid)
        if meta_in_payload:
            price_meta = _parse_price_meta(meta_payload)
        elif existing:
            old_price = existing.price
            old_meta = existing.price_meta
            if (str(old_price or '').strip() or None) == price:
                price_meta = _parse_price_meta(old_meta)
            else:
                price_meta = {'source': 'manual', 'synced_at': int(now)}
        elif 'price' in payload:
            price_meta = {'source': 'manual', 'synced_at': int(now)}
        else:
            price_meta = None
        price_meta_json = (
            json.dumps(price_meta, ensure_ascii=False, separators=(',', ':'))
            if price_meta
            else None
        )
        crud.upsert_llm_model(
            session=session,
            row=LlmModel(
                id=mid,
                label=label,
                description=description,
                provider=provider,
                kind=kind,
                api_model=api_model,
                icon_key=icon_key,
                icon_url=icon_url,
                price=price,
                max_attachments=max_attachments,
                thinking=thinking,
                enabled=enabled,
                sort_order=sort_order,
                reference_types=ref_types_json,
                image_limits=limits_json,
                price_meta=price_meta_json,
                pricing_id=pricing_id,
                created_at=now if not existing else float(existing.created_at or now),
                updated_at=now,
            ),
        )
    item = get_model(mid)
    if not item:
        raise RuntimeError('upsert failed')
    return item


def delete_model(model_id: str) -> bool:
    from sqlmodel import Session

    from app import crud
    from app.core.db import engine

    init_schema()
    mid = (model_id or '').strip()
    if not mid:
        return False
    now = time.time()
    with Session(engine) as session:
        return crud.delete_llm_model(session=session, model_id=mid, removed_at=now)
