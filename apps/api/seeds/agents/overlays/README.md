# Agent profile overlays

Optional deep-merge patches applied after loading `profiles/{id}.yaml`.

Load order:

1. `overlays/{profile_id}.patch.yaml` (e.g. `design.canvas.patch.yaml`)
2. `overlays/local.patch.yaml` (shared dev overlay, commit if team-wide)
3. `agent-overrides/local.patch.yaml` (per-machine, gitignored)

Use for local experiments without editing the canonical profile seed.
