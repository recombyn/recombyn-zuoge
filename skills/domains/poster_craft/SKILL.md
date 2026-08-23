# Poster / roll-up (Skill V3 golden sample)

Deliverable: **海报 / poster / 易拉宝 / roll-up / 演唱会 KV**.
Kernel still Decide → Paint → Observe → Review. This skill owns craft process.

## Process (mandatory order)

```text
INPUT
 → BRIEF          (P0 design_brief fields)
 → ART DIRECTION  (visual_thesis + style DNA / materials)
 → LAYOUT PLAN    (composition archetype + hard ratios)
 → DESIGN SYSTEM  (tokens / type ladder)
 → EXECUTION      (paint ops — hero first)
 → OBSERVE        (host geometry facts only)
 → REVIEW         (scores; Runtime totals)
 → CORRECTION     (fix toward brief + subtraction)
 → FINAL
```

Do **not** jump to glass cards / particles / equal decorations.

## 1. Brief (P0)

Fill before paint:

| Field | Poster focus |
|-------|----------------|
| purpose | What sticks in ~1s? |
| audience | Who |
| emotion | 2–4 words |
| visual_thesis | One concrete sentence (materials + focus + what it is not) |
| visual_hero | Single primary subject |
| composition | archetype + rules |
| avoid | ≥3 bans (often include purple gradient / particles / HUD) |

P1 when known: `visual_focus` (e.g. hero 70 / secondary 20 / env 10), `palette`, `typography`, `style_dna`, `reference_lock`.

## 2. Visual thesis examples

Bad: `仙侠高级感`

Good: `把这把剑当作博物馆神兵：冷银、旧玉、暗金浮雕；克制东方神性，不是游戏装备海报。`

## 3. Composition (pick one)

`center_hero` · `rule_of_thirds` · `bottom_weighted` · `diagonal` · `full_bleed` · `minimalist` · `editorial` · `dense_info` (only if asked)

### Default hard rules (center / full-bleed)

```text
hero_coverage: 60–85%
text_area: ≤ 20%
primary_focal: 1
secondary_focal: ≤ 2
empty_space: ≥ 15%
cta: ≤ 1
```

Tall / roll-up rhythm: top title band → mid hero → bottom info; generous side margins.
Wide: subject vs copy left/right; mid-band safer for title.

## 4. Tokens / type

- Title ≫ support ≫ meta (clear jumps; language matches user)
- Prefer catalog fonts; lettering plate via `image_gen` when display needs it
- Quiet bands for type on busy grounds

## 5. Execution stack

1. `create_frame` (CANVAS_SIZE / deliverable size)
2. Hero bitmap via `image_gen` when atmosphere needs it
3. Sparse vector structure only if it serves the thesis
4. Title → support → optional CTA
5. **Second pass = refine / subtract — not add decoration**

Vector vs image: simple geometry → vector; rich light/material/photo → bitmap. If vectors look crude, use image.

## 6. Honesty

Unless the user provides them, do not invent logos, prices, phones, QR, review counts.

## Hard rules

1. Brief P0 before paint.
2. One thesis, one hero, one primary focal.
3. If two elements fight for attention → fix before settle.
4. Anti-slop bans apply (see `anti_ai_slop`).
5. Subtraction pass required when Review score 70–89.

## Done when

- Far: tone + title readable in ~1s; matches thesis
- Near: medium matches complexity; type clear; avoid[] respected
- Review total ≥ 90 (Runtime) with no blocker / slop hits

## Related

`image_gen` (bitmaps) · foundations via `extends` · `garden_style` only if user asks festive taste
