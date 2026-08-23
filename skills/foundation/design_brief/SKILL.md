# Design Brief (foundation)

Internal execution contract for Paint / Review. Not user-facing copy.

## Process

```text
INPUT → BRIEF (this skill) → ART DIRECTION → LAYOUT → SYSTEM → EXECUTION → …
```

## Hard rules

### P0 required (create / complex edit)

| Field | Must answer |
|-------|-------------|
| `purpose` | What job does this piece do? |
| `audience` | Who sees it? |
| `emotion` | 2–4 tone words |
| `visual_thesis` | One sentence visual argument (not “科技感”) |
| `visual_hero` | The single primary subject |
| `composition` | `{ "archetype": "…", "rules": {…} }` |
| `avoid` | Explicit anti-list for this run |

### P1 optional (fill only when known)

`visual_focus` · `palette` · `typography` · `tokens` · `reference_lock` · `style_dna`

**Do not invent junk** to fill P1. Dashboard ≠ Poster ≠ Image Gen.

## Thesis quality

Bad: `科技感` / `高级` / `好看`

Good: one concrete sentence — materials, space, single focus, what it is *not*.

## Checklist

- [ ] P0 complete before paint
- [ ] Thesis is falsifiable (Review can check fidelity)
- [ ] `avoid` names at least 3 concrete bans for this brief
- [ ] `subtraction_intent: true` unless user asked for dense collage
