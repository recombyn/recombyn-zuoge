# Eval (public)

Open Design Agent quality track. No private rankings or closed corpora here.

```text
eval/
├── README.md                 # this file
├── framework/                # → packages/eval-framework
├── public/                   # alias docs for the public suite
└── design-agent/             # public suite + runners (canonical path)
    ├── suite.json
    ├── rubric.json
    ├── baseline.json
    ├── tasks/                # first-phase open tasks
    ├── refs/good|bad/
    └── results/              # gitignored run output
```

| Piece | Path | License surface |
|-------|------|-----------------|
| Compare helpers | `packages/eval-framework` | Apache-2.0 |
| Public suite | `eval/design-agent/` | Apache-2.0 |
| Private rankings / closed datasets | **not in this repo** | operator-only |

```bash
npm run eval:agent
npm run eval:compare
```

Operator-only eval corpora live outside this repository. See [ADR 0023](../docs/adr/0023-public-private-eval.md).
