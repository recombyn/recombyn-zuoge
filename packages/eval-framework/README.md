# @recombyn/eval-framework (Apache-2.0)

Public helpers for Design Agent eval regression:

- Score extraction from run results
- Baseline compare gates (avg drop / key-task drop)
- Skill version discovery from the open `skills/` catalog

**Public suite data** lives under `eval/design-agent/` (tasks, rubric, baseline).

This package ships compare helpers only. Keep large operator-specific ranking
corpora and custom judge weights out of the tree; point compare at your own
result JSON when needed.
