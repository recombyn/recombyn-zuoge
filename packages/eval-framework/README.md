# @recombyn/eval-framework (Apache-2.0)

Public helpers for Design Agent eval regression:

- Score extraction from run results
- Baseline compare gates (avg drop / key-task drop)
- Skill version discovery from the open `skills/` catalog

**Public suite data** lives under `eval/design-agent/` (tasks, rubric, baseline).

This package does **not** ship private human rankings, proprietary judge
weights, or closed datasets. Operators may point compare at their own
result JSON; do not commit private eval corpora into this repository.
