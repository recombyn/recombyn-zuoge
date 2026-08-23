"""Design token packs — scene design-system tokens for prompt injection.

Shape mirrors big-tech DS (TDesign-like): semantic color, type scale, elevation,
component metrics — not a few prose lines. Injected as named refs for tool_ops.
"""
from __future__ import annotations

import json
import time
from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.services.design.readpath.catalog import ensure_design_catalog

# Seed: seeds/design_tokens_seed.json (bump schemaVersion to upgrade rows).


def _load_tokens_seed() -> tuple[str, dict[str, Any], list[dict[str, Any]]]:
    from app.core.config import resolve_seed_file

    path = resolve_seed_file("design_tokens_seed.json")
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return "", {}, []
    if not isinstance(parsed, dict):
        return "", {}, []
    ver = str(parsed.get("schemaVersion") or "").strip()
    default = parsed.get("defaultTokens")
    if not isinstance(default, dict):
        default = {}
    else:
        default = dict(default)
    if ver and not default.get("schemaVersion"):
        default["schemaVersion"] = ver
    packs_raw = parsed.get("packs") or []
    packs = (
        [x for x in packs_raw if isinstance(x, dict)]
        if isinstance(packs_raw, list)
        else []
    )
    return ver, default, packs


TOKEN_SCHEMA_VERSION, _, _SEED = _load_tokens_seed()


def _csv_has(csv: str, token: str) -> bool:
    """True only when csv lists token, or explicitly lists ``all``. Empty csv → False."""
    parts = {p.strip().lower() for p in str(csv or "").split(",") if p.strip()}
    if not parts:
        return False
    if "all" in parts:
        return True
    return bool(token) and token.strip().lower() in parts


def _parse_tokens(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            data = json.loads(raw)
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _pub(r: Any) -> dict[str, Any]:
    tokens_raw = r.tokens_json if hasattr(r, "tokens_json") else r["tokens_json"]
    updated = r.updated_at if hasattr(r, "updated_at") else r["updated_at"]
    return {
        "id": int(r.id if hasattr(r, "id") else r["id"]),
        "name": str((r.name if hasattr(r, "name") else r["name"]) or ""),
        "scenes": str((r.scenes if hasattr(r, "scenes") else r["scenes"]) or ""),
        "tokens": _parse_tokens(tokens_raw),
        "isDefault": bool(
            int((r.is_default if hasattr(r, "is_default") else r["is_default"]) or 0)
        ),
        "sortOrder": int(
            (r.sort_order if hasattr(r, "sort_order") else r["sort_order"]) or 0
        ),
        "enabled": bool(
            int((r.enabled if hasattr(r, "enabled") else r["enabled"]) or 0)
        ),
        "note": str((r.note if hasattr(r, "note") else r["note"]) or ""),
        "updatedAt": int(float(updated) * 1000) if updated else None,
    }


def ensure_design_token_packs() -> None:
    """Insert seed packs only when the table is empty. Never overwrite Admin packs."""
    now = time.time()
    with Session(engine) as session:
        if crud.count_design_token_packs(session=session) > 0:
            return
        for item in _SEED:
            crud.insert_design_token_pack_seed(
                session=session,
                name=str(item["name"]),
                scenes=str(item["scenes"]),
                tokens_json=json.dumps(item["tokens"], ensure_ascii=False),
                is_default=1 if item.get("is_default") else 0,
                sort_order=int(item.get("sort_order") or 0),
                note=str(item.get("note") or ""),
                created_at=now,
            )
        session.commit()


def list_token_packs(*, enabled: bool | None = True, ensure: bool = True) -> list[dict[str, Any]]:
    if ensure:
        ensure_design_catalog()
        ensure_design_token_packs()
    with Session(engine) as session:
        rows = crud.list_design_token_packs(session=session, enabled=enabled)
    return [_pub(r) for r in rows]


def upsert_token_pack(payload: dict[str, Any]) -> dict[str, Any]:
    ensure_design_catalog()
    ensure_design_token_packs()
    pid = payload.get("id")
    name = str(payload.get("name") or "").strip()[:128]
    if not name:
        raise ValueError("name required")
    scenes = str(payload.get("scenes") or "").strip()[:128]
    if not scenes:
        raise ValueError("scenes required")
    tokens = payload.get("tokens")
    if not isinstance(tokens, dict) or not tokens:
        raise ValueError("tokens object required")
    # Stamp schema when admin saves a pack based on current defaults.
    if "schemaVersion" not in tokens:
        tokens = {**tokens, "schemaVersion": TOKEN_SCHEMA_VERSION}
    is_default = 1 if payload.get("isDefault") else 0
    sort_order = int(payload.get("sortOrder") or 0)
    enabled = 1 if payload.get("enabled", True) else 0
    note = str(payload.get("note") or "")
    with Session(engine) as session:
        row = crud.upsert_design_token_pack(
            session=session,
            item_id=int(pid) if pid else None,
            name=name,
            scenes=scenes,
            tokens_json=json.dumps(tokens, ensure_ascii=False),
            is_default=is_default,
            sort_order=sort_order,
            enabled=enabled,
            note=note,
        )
    return _pub(row)


def soft_delete_token_pack(item_id: int) -> bool:
    ensure_design_catalog()
    ensure_design_token_packs()
    with Session(engine) as session:
        return crud.soft_delete_design_token_pack(
            session=session, item_id=int(item_id)
        )


def resolve_token_pack(*, scene: str) -> dict[str, Any]:
    """Pick enabled default pack for scene. Missing pack → empty tokens (fix seed/DB)."""
    # Read-only for design-run hot path — seed/bootstrap is process startup.
    scene_l = str(scene or "").strip().lower()
    packs = list_token_packs(enabled=True, ensure=False)
    best: dict[str, Any] | None = None
    best_score = -1
    for p in packs:
        if scene_l and not _csv_has(p["scenes"], scene_l):
            continue
        if not scene_l and not p.get("isDefault"):
            continue
        score = 0
        if p.get("isDefault"):
            score += 10
        if str(p.get("scenes") or "").strip().lower() == scene_l:
            score += 5
        if score > best_score:
            best_score = score
            best = p
    if best:
        return {
            "id": best.get("id"),
            "name": best.get("name"),
            "scenes": best.get("scenes"),
            "tokens": dict(best.get("tokens") or {}),
        }
    return {
        "id": None,
        "name": "",
        "scenes": scene_l,
        "tokens": {},
    }


def _flatten_leaves(prefix: str, node: Any, out: list[tuple[str, Any]]) -> None:
    if isinstance(node, dict):
        for k, v in node.items():
            key = f"{prefix}.{k}" if prefix else str(k)
            _flatten_leaves(key, v, out)
    else:
        out.append((prefix, node))


def format_token_block(pack: dict[str, Any] | None) -> str:
    """Named design-system refs for the model (not a short prose blurb)."""
    if not pack:
        return ""
    tokens = pack.get("tokens") or {}
    name = pack.get("name") or "tokens"
    ver = tokens.get("schemaVersion") or TOKEN_SCHEMA_VERSION
    lines = [
        f"DESIGN_TOKENS ({name}) schema={ver}",
        "Use these named values in tool_ops (fill/color/fontSize/cornerRadius/height/padding).",
        "Prefer token hex/sizes over inventing new ones unless USER_PROMPT overrides.",
        f"- grid: {tokens.get('grid', 8)}px",
    ]

    margin = tokens.get("margin") or {}
    gap = tokens.get("gap") or {}
    spacing = tokens.get("spacing") or {}
    radius = tokens.get("radius") or {}
    allowed = tokens.get("radiusAllowed") or list((radius or {}).values())
    contrast = tokens.get("contrast") or {}
    touch = tokens.get("touch") or {}

    lines.append(
        f"- margin.safe ≥ {margin.get('safe', 16)}px; gap.min ≥ {gap.get('min', 8)}px; "
        f"bottomCta ≥ {margin.get('bottomCta', 24)}px"
    )
    if isinstance(spacing, dict) and spacing:
        lines.append("- spacing: " + ", ".join(f"{k}={v}" for k, v in spacing.items()))
    if isinstance(radius, dict) and radius:
        lines.append(
            "- radius: "
            + ", ".join(f"{k}={v}" for k, v in radius.items() if k != "pill")
        )
    if allowed:
        lines.append(
            f"- cornerRadius ∈ {{{', '.join(str(int(x)) for x in allowed)}}} "
            "or pill (half short side)"
        )

    color = tokens.get("color") or {}
    for group in ("brand", "status", "text", "bg", "border"):
        block = color.get(group)
        if isinstance(block, dict) and block:
            lines.append(
                f"- color.{group}: "
                + ", ".join(f"{k}={v}" for k, v in block.items())
            )
    ratio = color.get("ratio") or {}
    if ratio:
        lines.append(
            f"- color.ratio ~ primary {ratio.get('primary', 60)}% / "
            f"secondary {ratio.get('secondary', 30)}% / accent {ratio.get('accent', 10)}%; "
            f"hueMax ≤ {color.get('hueMax', 3)}"
        )

    typ = tokens.get("type") or {}
    size = typ.get("size") if isinstance(typ, dict) else None
    if isinstance(size, dict) and size:
        lines.append("- type.size: " + ", ".join(f"{k}={v}" for k, v in size.items()))
    weight = typ.get("weight") if isinstance(typ, dict) else None
    if isinstance(weight, dict) and weight:
        lines.append("- type.weight: " + ", ".join(f"{k}={v}" for k, v in weight.items()))
    families = typ.get("families") if isinstance(typ, dict) else None
    if isinstance(families, list) and families:
        lines.append(f"- type.families (≤{typ.get('familiesMax', 2)}): " + ", ".join(str(x) for x in families))

    elev = tokens.get("elevation") or {}
    if isinstance(elev, dict) and elev:
        lines.append("- elevation: " + ", ".join(f"{k}" for k in elev.keys()))

    comp = tokens.get("component") or {}
    if isinstance(comp, dict):
        for cname, cval in comp.items():
            if not isinstance(cval, dict):
                continue
            flat: list[tuple[str, Any]] = []
            _flatten_leaves("", cval, flat)
            # Resolve radius token name → px for clarity.
            pretty = []
            for path, val in flat:
                if path.endswith("radius") and isinstance(val, str) and isinstance(radius, dict):
                    px = radius.get(val, val)
                    pretty.append(f"{path}={val}({px})")
                else:
                    pretty.append(f"{path}={val}")
            if pretty:
                lines.append(f"- component.{cname}: " + "; ".join(pretty))

    lines.append(
        f"- contrast body ≥ {contrast.get('body', 4.5)}:1; large ≥ {contrast.get('large', 3.0)}:1"
    )
    if touch.get("min"):
        lines.append(f"- touch.min edge ≥ {touch.get('min')}px")
    lines.append("- no severe overlap; no near-miss align (2–8px off)")
    lines.append(
        "Map UI roles: primary CTA → color.brand.primary + component.button.*; "
        "page chrome → color.bg.*; body copy → color.text.primary + type.size.body."
    )
    return "\n".join(lines)
