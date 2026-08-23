# Skills (Apache-2.0)

Open Design Agent skill packs shipped with Recombyn.

```text
skills/
├── foundation/     # Core craft — brief, type, color, layout, review, …
└── domains/        # Surfaces / deliverables — poster, landing, dashboard, …
```

## Pack layout

```text
<skill_key>/
├── _meta.json      # required
├── SKILL.md        # required — methodology / rules
├── schema.json     # optional
├── assets/         # optional
└── examples/       # optional — public examples only
```

## What belongs here

- Public methodology, schemas, and examples that third parties can reuse
- Foundation + domain playbooks for BasicLocal / community installs

## What does not belong here

Do **not** commit proprietary prompts, private datasets, production judge
rubrics, or closed model/routing notes into this tree. Operator-private packs
go under `plugins/skills/` (see that folder’s README).

## Load order

Design Agent scans (later wins on duplicate `skill_key`):

1. `skills/foundation`
2. `skills/domains`
3. `plugins/skills` (+ `DESIGN_SKILLS_PLUGIN_DIRS`)
