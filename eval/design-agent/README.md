# Design Agent Eval (Gate A quality track)

Craft quality cases, not load tests. Suite: `suite.json` (from `apps/api/seeds/design_agent_eval_suite.json`). Rubric: `rubric.json` — **same caps as Runtime Review** (sum 100; Host owns total). Compare helpers: `@recombyn/eval-framework` (see `eval/framework/`).

First-phase V3 dataset: **40 tasks** (10 poster + 10 landing + 10 dashboard + 10 image). Do not expand to 100 until this set is stable.

```bash
# API up + EVAL_TOKEN / E2E_TOKEN / .tmp-token.txt
npm run eval:agent
npm run eval:agent -- poster banner
npm run eval:agent -- --system
npm run eval:agent -- --v3-tasks

# Poster matrix: Ask / Canvas ops / Image layers
npm run eval:agent -- poster --ask
npm run eval:agent -- poster --paint-mode=ops
npm run eval:agent -- poster --paint-mode=img_layers

# After a v3-tasks run: compare results/latest.json to baseline.json
npm run eval:compare

# Reference-image eval
node eval/design-agent/ref-ui.mjs
```

Layout (V3):

```text
eval/design-agent/
├── suite.json
├── rubric.json
├── baseline.json   # PR19 regression baseline (skill version / scores)
├── compare.mjs     # FAIL if avg drop > 3 or key task drop > 5
├── tasks/          # 40 first-phase family tasks
├── refs/good|bad/
└── results/        # run output (gitignored) + compare.json
```

Regression record per task: skill version, model, task id, score, issues.

Env: `EVAL_API` (or `E2E_API`), `EVAL_TOKEN` (or `E2E_TOKEN`), `EVAL_CONCURRENCY`, `EVAL_CASE_MS`, `EVAL_OUT`, `EVAL_INTERACTION_MODE`, `EVAL_PAINT_MODE`.

Load / concurrency → `perf/k6` (`docs/quality-gates.md`).
