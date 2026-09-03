# Eval

Open Design Agent quality track. Suite fixtures live in-tree under `eval/`.

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

```bash
npm run eval:agent
npm run eval:compare
```

There is no separate private-eval tree in this repo. See [ADR 0023](../docs/adr/0023-public-private-eval.md).
