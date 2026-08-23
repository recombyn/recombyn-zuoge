# Eval layout (public)

```text
eval/
├── framework/          # docs pointer → packages/eval-framework
└── design-agent/       # public suite, rubric, baseline, runners
```

- **Framework:** `@recombyn/eval-framework` — compare helpers + open skill version lookup
- **Public suite:** `eval/design-agent/` — 40 first-phase tasks + rubric aligned to Runtime caps
- **Alias:** `eval/public/` → documents the public suite without a breaking rename

Do not commit private human rankings or closed eval corpora here ([ADR 0023](../../docs/adr/0023-public-private-eval.md)).
