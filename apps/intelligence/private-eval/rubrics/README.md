# Rubrics (gitignored payloads)

Put proprietary judge weight JSON here. Files are **not** committed (`*` + keep README).

## Schema

```json
{
  "id": "poster_v3",
  "weights": {
    "composition": 1.4,
    "typography": 1.2,
    "brand": 0.9,
    "originality": 1.15,
    "user_fit": 0.85,
    "technical": 0.85
  }
}
```

Dims must match tournament dims: `composition`, `typography`, `brand`, `originality`, `user_fit`, `technical`.

## Load order

1. `RECOMBYN_TOURNAMENT_RUBRIC` → absolute path to a JSON file  
2. `private-eval/rubrics/active.json`  
3. `private-eval/rubrics/default.json`  
4. first `*.json` in this folder  

If none exist, the private tournament engine uses baked niche/category rubrics.
