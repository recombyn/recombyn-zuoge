# Design Engine V3 baseline (PR0+)

Fixtures and regression tests that protect existing Canvas tool_ops while
Skill / Brief / Transaction layers evolve. Eval dataset + skill-regression
compare live in `test_eval_rubric.py` (40 first-phase tasks).

## Phase 1 acceptance (10)

Must all pass before Phase 2. Run:

```bash
node scripts/run-api-tests.mjs tests/design_engine/test_v3_acceptance.py -q
npm run test:web -- src/components/editor/panels/agent/__tests__/v3Acceptance.test.ts
```

| # | Item | Test |
|---|------|------|
| 01 | Create poster | `test_01_create_poster_via_tool_ops` |
| 02 | Edit poster | `test_02_edit_poster_via_update_node` |
| 03 | Review `<70` rebuild | `test_03_review_below_70_rebuilds_not_repair` |
| 04 | Review `70–89` repair | `test_04_review_70_to_89_auto_repair` |
| 05 | Review `>=90` pass | `test_05_review_at_90_passes_then_polish_once` |
| 06 | AI Transaction Undo | web `v3Acceptance` 06 |
| 07 | Mid-fail Rollback | API `test_07_*` + web 07 |
| 08 | User edit + AI revision conflict | web `v3Acceptance` 08 |
| 09 | Yjs + AI mutation | web `v3Acceptance` 09 |
| 10 | Skill eval score compare | `test_10_skill_eval_score_compare_fails_on_drop` |

Full design_engine suite:

```bash
node scripts/run-api-tests.mjs tests/design_engine -q
```

Phase 2 starts at `test_intelligence_contracts.py` (P21 schemas).
P22 Reference Intelligence: `test_reference_intelligence.py`.
P23 Design Memory: `test_design_memory.py` (User / Project / Session persist + retrieve).
P24 Preference Learning: `test_preference_learning.py` (one edit = evidence; 5× same direction commits to Brief).
P25 Design KG chain: `test_design_kg.py` (Principle → Pattern → Context → Execution → Issue → Correction → Outcome).
P26 Seven reviewer lanes: `test_review_lanes.py` (distinct lanes; Host merges; anti_slop is hits).
P27 Judge: `test_judge.py` (Runtime overall; top_issues with priority / evidence / fix).
P28 Visual Diff: `test_visual_diff.py` (geometry from Observe snapshot; pixel only when both screenshots decode).
P29 Optimization: `test_optimization.py` (stop / rollback to V2 / Pareto 91·38 beats 92·100).
P30 Skill evolution: `test_skill_evolution.py` (mine failures → proposal diff → human approve → regression → deploy; never auto-overwrite).
P31 Agent panel: web `designIntelligence.test.ts` (DNA / seven scores / Diff / iterations in existing panels/agent). Phase 2 complete when these pass.

Phase 3 starts at P32 Design Research.
P32 Design Research: `test_design_research.py` (pipeline → ANTI-CATEGORY; Brief avoid merge; never paints). Do not implement P33+ until these pass.
P33 Strategy Engine: `test_design_strategy.py` (Research → Strategy → Brief; positioning / axes / ANTI-CATEGORY; never paints). Do not implement P34+ until these pass.
P34 Multi-Candidate: `test_design_candidates.py` (Strategy → A–E / V1–V5; Runtime only; unselected never paint). Do not implement P35+ until these pass.
P35 Tournament: `test_design_tournament.py` (multi-dim bracket ≠ raw total; Winner / Runner-up / Alternative; user pick). Do not implement P36+ until these pass.
P36 Art Director Swarm: `test_design_swarm.py` (delegate leads+craft; AD resolves type vs composer; need_subagents; never paints). Do not implement P37+ until these pass.
P37 Simulation: `test_design_simulation.py` (pre-paint Attention/Hierarchy; CTA<10% adjusts; never mutates canvas). Do not implement P38+ until these pass.
P38 Counterfactual: `test_design_counterfactual.py` (Hero−20% virtual deltas; select→Repair draft; never pollutes canvas). Do not implement P39+ until these pass.
P39 Skill A/B: `test_skill_ab.py` (V12-A vs V12-B → winner candidate; human promote only; never auto-overwrite). Do not implement P40+ until these pass.
P40 Cross-project Principle: `test_cross_project_principle.py` (abstract Principle; reject 120px/client; migrate without brand). Do not implement P41+ until these pass.
P41 Governance: `test_design_governance.py` (settle hard gate; Brand/A11y/…; FAIL→Explain→Repair). Do not implement P42+ until these pass.
P42 Autonomous Art Director: `test_autonomous_art_director.py` (goal-only OS plan; micro-edit skipped; hop sync; never paints). Phase 3 complete when these pass.
Intelligence client: `test_intelligence_client.py` (BasicLocal provider via `packages/intelligence-client`; ADR 0017).
Protocol package: `test_protocol_package.py` (`packages/protocol` constants/schemas; public contracts only).
Skills catalog: `test_skills_catalog.py` (`skills/foundation` + `skills/domains`; ADR 0018).
Eval framework: `@recombyn/eval-framework` + `eval/framework` (public compare helpers; suite under `eval/design-agent`).
