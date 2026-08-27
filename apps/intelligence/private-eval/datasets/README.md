# Closed datasets (gitignored)

Put proprietary task packs here as `*.json`. Files are **not** committed.

## Quick start

```bash
# Copy the committed example shape, then edit prompts locally:
copy private-eval\fixtures\dataset.example.json private-eval\datasets\week2.json

python private-eval/run.py
# → private-eval/results/latest.json
```

## Task schema

```json
{
  "suite": "week2",
  "tasks": [
    {
      "id": "unique-id",
      "method": "research",
      "body": {
        "prompt": "…",
        "scene_key": "poster",
        "flags": {}
      },
      "expect_keys": ["niches", "paint_checks"]
    },
    {
      "id": "full-max",
      "method": "stack",
      "stack": [
        "research",
        "strategy",
        "propose_candidates",
        "tournament",
        "swarm_direction",
        "simulate",
        "counterfactual",
        "retrieve_memory"
      ],
      "body": {
        "prompt": "…",
        "scene_key": "website",
        "flags": {}
      }
    }
  ]
}
```

`method` may be any intelligence hop (`research`, `strategy`, `tournament`, …)
or `stack` / `ab` for multi-hop.

## Product A/B (local vs cloud)

1. Run `python private-eval/run.py --ab` → `results/ab_latest.md`
2. In API `.env`: `RECOMBYN_INTELLIGENCE_MODE=local` → same prompts at intensity=Max
3. Switch to `cloud` + this service on `:8091` → same prompts
4. Diff Decide activity / strategy / tournament rubric / swarm directions

Do not commit closed prompts, ranking CSVs, or customer briefs.
