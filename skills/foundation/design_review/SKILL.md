# Design Review (qa)

Dimensional craft gate. **Runtime sums `total` — do not invent it.**

## Hard rules

### Caps

| Dimension | Cap |
|-----------|-----|
| composition | 20 |
| hierarchy | 20 |
| typography | 15 |
| color | 15 |
| consistency | 15 |
| content | 10 |
| originality | 5 |
| **sum** | **100** |

### Host thresholds

| Total (0–100) | Action |
|------:|--------|
| < 70 | Rework (must_fix) |
| 70–89 | Fix majors + subtraction / polish |
| ≥ 90 | Pass only if no blocker/major/slop hits |

Caps sum to exactly 100. Runtime `total = sum(scores)`.

### What you judge (Review)

- Focal clarity vs brief thesis
- Hierarchy / type / color / consistency / content honesty / originality
- Anti-slop hits + subtraction actions

### What you do NOT invent

- Geometry overflow / overlap / stacked creates → those are **OBSERVE_FACTS**
- A fake `total` that disagrees with scores

## Checklist

- [ ] scores filled within caps
- [ ] no `total` field (or Host overwrites)
- [ ] must_fix when score gate or majors remain
- [ ] fix_brief imperative toward DESIGN_BRIEF
