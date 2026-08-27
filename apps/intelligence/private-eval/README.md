# private-eval

Internal Design Agent evaluation corpora — gitignored data only.

```text
private-eval/
├── README.md
├── LANDING.md
├── run.py                 # --smoke | --ab | datasets/*.json
├── fixtures/
│   ├── smoke.json         # hop expect_keys
│   ├── ab_pack.json       # Max-stack A/B prompts (committed)
│   └── dataset.example.json
├── results/               # gitignored latest.json / ab_latest.md
├── datasets/              # gitignored closed corpora
├── rankings/
└── rubrics/
```

```bash
# Smoke (hop contracts)
python private-eval/run.py --smoke

# A/B brief cards (Max stack → results/ab_latest.md)
python private-eval/run.py --ab

# Closed corpora
copy private-eval\fixtures\dataset.example.json private-eval\datasets\week2.json
python private-eval/run.py
```

Keep placeholders and docs only. Do not commit raw ranking CSVs, closed task
packs, or production judge prompts. Never wire this into Public CI.
