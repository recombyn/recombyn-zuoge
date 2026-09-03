# Eval layout

```text
eval/
├── framework/          # docs pointer → packages/eval-framework
└── design-agent/       # suite, rubric, baseline, runners
```

- **Framework:** `@recombyn/eval-framework` — compare helpers + skill version lookup
- **Suite:** `eval/design-agent/` — 40 first-phase tasks + rubric aligned to Runtime caps
- **Alias:** `eval/public/` → documents the suite without a breaking rename

Do not add a separate `private-eval` tree here; keep operator corpora outside
the monorepo if needed ([ADR 0023](../../docs/adr/0023-public-private-eval.md)).
