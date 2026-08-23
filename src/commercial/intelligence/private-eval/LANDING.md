# Intelligence quality landing (operators)

Goal: prove Remote ≠ BasicLocal, then deepen engines.

## Week 1 — measure

```bash
# From src/commercial/intelligence/
python private-eval/run.py --smoke
# Writes private-eval/results/latest.json (hop ok + key fingerprints)
```

## Week 1 — product depth (Kernel already shipped)

Intensity hops (Decide):

| Intensity | Intelligence hops |
|-----------|-------------------|
| light | ref + memory + plan only |
| medium | + research, strategy |
| high | + candidates, tournament, swarm |
| extreme | + simulate, counterfactual, write_principle |

UI: Auto + Light/Med/High/Max maps to these.

## Week 2 — private engines (done)

1. research / strategy / tournament / swarm / simulate / counterfactual / taste_kg
2. candidates — niche lane patches + niche `primary_id`
3. Kernel Decide formatters + `emit_intelligence_brief` (Admin activity / analysis_delta)

## Week 3 — ops A/B

```bash
python private-eval/run.py --ab
# → results/ab_latest.md

copy private-eval\fixtures\dataset.example.json private-eval\datasets\week2.json
python private-eval/run.py
```

Product compare:

1. `RECOMBYN_INTELLIGENCE_MODE=local` → Max on `ab_pack.json` prompts
2. `cloud` + service `:8091` → same prompts
3. Diff niches / rubric / swarm / CF / memory
4. Admin log: `intelligence_brief` / `INTELLIGENCE_BRIEF`

Checklist:

- [ ] Halloween → `seasonal_event`
- [ ] candidates `primary_reason` starts with `niche:`
- [ ] Decide suffix has paint_checks / directives
- [ ] poster does not false-fire CTA&lt;10% as main gate
- [ ] activity `intelligence-brief` on Med+

Do not commit ranking CSVs or production judge prompts.
