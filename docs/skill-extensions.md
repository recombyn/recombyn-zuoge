# Skill extensions (authoring)

You can teach the Design Agent a new category of work with a Skill pack — same layout as shipped packs under `skills/foundation` and `skills/domains`. Shipped packs are built-in; yours go under `plugins/skills/`.

## Roots

| Path | Role |
|------|------|
| `skills/foundation/<key>/` | Shipped core craft (open) |
| `skills/domains/<key>/` | Shipped surfaces / deliverables (open) |
| `plugins/skills/<key>/` | Private / self-host extensions (Compose-mounted) |

Do **not** put product skills in `.agents/skills/` — that tree is for Cursor/IDE coding agents only.

## V3 shipped catalog

```text
skills/
├── foundation/
│   ├── design_brief/
│   ├── visual_direction/
│   ├── design_system/
│   ├── composition/
│   ├── typography/
│   ├── color/
│   ├── imagery/
│   ├── layout/
│   ├── responsive/
│   ├── anti_ai_slop/
│   ├── design_review/
│   └── polish/
└── domains/
    ├── poster_craft/
    ├── landing_page/
    ├── dashboard_ui/
    ├── image_gen/
    └── …
```

Other domain packs (`banner_ad`, `mobile_app_ui`, …) live under `skills/domains`; Decide still picks one surface.

## Canonical layout

```
my_poster_plugin/
├── _meta.json        # required
├── SKILL.md          # required
├── schema.json       # optional — input / output JSON Schema
├── handler.py        # optional — reserved (Phase B runner; not executed yet)
├── assets/           # optional — logo / icon / previews
└── examples/         # optional — reference art (not loaded by runtime)
```

Required today: `_meta.json` + `SKILL.md`.  
Everything else is optional; missing files are fine.

## `_meta.json`

| Field | Required | Notes |
|-------|----------|--------|
| `skill_key` | yes | Technical id (folder name if omitted) |
| `when_to_use` | recommended | Catalog + routing |
| `preferred_tools` | recommended | Live op allowlist |
| `triggers` | recommended | Auto-attach (`intent_in` + `prompt_includes_any`) |
| `version` / `enabled` / `author` | optional | `enabled: false` skips pack |
| `allowed_resources` | optional | ACL surface |

## `schema.json` (optional)

```json
{
  "input_schema": { "type": "object", "properties": { "...": {} }, "required": [] },
  "output_schema": { "type": "object", "allowed_ops": ["create_frame", "create_text"] }
}
```

Values merge into the skill row (meta fields win if both set). Live paint gating:

- `preferred_tools` — primary allowlist; multiple skills **union**.
- `output_schema.allowed_ops` — extra gate only when **every** loaded skill
  declares it (then union). A skill that omits `allowed_ops` does not tighten
  the round, so `mobile_app_ui` + `image_gen` keeps UI shape/text tools.

## `handler.py` (optional ops runner)

When **`DESIGN_SKILL_OPS_RUNNER=true`**, Paint will try the first loaded skill that has `handler.py` **before** the LLM:

```python
def run(ctx: dict, payload: dict) -> list[dict]:
    """Return tool_ops only — never mutate Redis/DB/canvas directly."""
    return [{"name": "create_frame", "args": {...}}, ...]
```

- Subprocess + timeout (`DESIGN_SKILL_OPS_RUNNER_TIMEOUT_SEC`, default 8s)
- Output always passes `validate_ops` (`preferred_tools` / contract)
- Empty or invalid → fall through to normal LLM paint

Sample: [`plugins/skills/festival_poster/handler.py`](../plugins/skills/festival_poster/handler.py) · [ADR 0015](./adr/0015-skill-ops-runner.md)

Default is **off** — craft in `SKILL.md` still works without a handler.

## `assets/` / `examples/`

- **`assets/icon.svg`** (or `logo.png`) — picked up as pack logo and inlined as a `data:` URL for the Skills list / `/` picker  
- `examples/` — human reference only

Shipped seeds already include `assets/icon.svg`.

## Load / reload

| Mode | Behavior |
|------|----------|
| Local API | Hot reload polls disk (default 2s) |
| Docker | `./plugins/skills:/app/plugins/skills` |
| Extra dirs | `DESIGN_SKILLS_PLUGIN_DIRS` |
| Admin zip | Still available |

Duplicate `skill_key`: **later root wins** (plugins override seeds).

## Sample

[`plugins/skills/festival_poster/`](../plugins/skills/festival_poster/) — 「生成中秋红色海报」.

## Out of scope here

- Frontend toolbar plugins — [canvas-plugins.md](./canvas-plugins.md) / ADR 0014  
- Full process sandbox / public-key plugin trust chain — later  

→ [ADR 0013](./adr/0013-skill-extensions.md) · [ADR 0015](./adr/0015-skill-ops-runner.md) · [plugin-packs.md](./plugin-packs.md)