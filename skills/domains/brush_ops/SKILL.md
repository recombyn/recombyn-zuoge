# Brush / pencil

Craft for **brush / pencil / 板绘 / 线稿 / pressure drawing** — freehand when the brief wants drawn marks. Medium follows the job: pressure ribbon vs simple vector vs complex bitmap.

## Design thinking

| Ask | Aim |
|-----|-----|
| **Is brush right?** | Sketch / ink / 线稿 — or UI chrome / photo hero / icons instead? |
| **Tone** | One drawn language per pass |
| **Brush family** | Sketch ≠ calligraphy ≠ marker — pick one `brushStyle` |
| **Bitmap vs vector vs brush** | Pressure / expressive freehand → `create_shape` pencil. Simple precise geometry → vector. Complex photo/atmosphere → bitmap. Soft-avoid faking brush with ellipse piles |
| **Economy** | Few confident strokes over timid spam |

Quality bar: **intentional design** — silhouette reads; pressure varies.

## How pencil works

Each stroke is `shapeType=pencil`: an **M/L centerline** plus a **filled-ribbon silhouette**. Live preview and commit use the same outline (`outlinePathFromPoints`).

- `path` — SVG `M/L` only, points along the gesture
- `borderWidth` — Size (Px)
- `stroke` — ribbon fill color
- `pathPressure` — csv `0–1`, same length as points
- `pressureEnabled` — hardware/stylus pressure modulates width
- Optional: `pencilFill`, `pencilOutlineWidth`, `pencilOutlineColor`

Shift+pencil: octant-straight segment.

## Stroke & composition

- Keep strokes on the current artboard.
- Plan a small budget (~3–12 strokes for a mark cluster).
- Pressure: lighter ends, heavier mid.
- Far check silhouette; near check pressure. Refine before rebuilding as geometry.

## brushStyle → intent

Default `vector-ink`. Emit one of:

| Id | Lean |
|----|------|
| `vector-ink` | Balanced ink; width follows pressure |
| `vector-even` | Near-constant width |
| `vector-calligraphy` | Strong pressure range |
| `vector-pencil` | Lighter sketch |
| `vector-marker` | Broad marks |
| `vector-brush` | Broad pressure-sensitive |
| `vector-fountain` | Fine ink |
| `vector-technical` | Even 线稿 |
| `vector-soft` | Soft wide marks |

## When another medium fits better

| Need | Prefer |
|------|--------|
| Simple precise geometry / icons | shape tools / `icon_set` |
| UI chrome | `shadcn_ui` |
| Complex photo / rich atmosphere | `image_gen` / `poster_craft` |
| Looping motion | `motion_animation` |

## Honesty

Soft-avoid using brush as a stand-in for missing fonts or icons. Soft-avoid covering a poster subject with scribble noise.

## Place on board

Confirm freehand → pick `brushStyle` → draw with `path` + `pathPressure` → refine.

## Related

`image_gen`, `poster_craft`, `icon_set`

## Done when

Silhouette reads; pressure varies; `brushStyle` matches intent; strokes stay on board.
