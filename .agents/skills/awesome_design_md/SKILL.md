# Brand visual parameters

Turn a visual system into a **parameter sheet**, then execute every paint against that sheet — do not invent a new style each turn.

## Principles
1. **Sheet is law for this run** — local edits must not break semantic colors or type scale.
2. **Roles > scattered hex** — primary / secondary / accent / muted / danger mean something.
3. **Ask short, never invent** — missing logo/slogan/hex → ask; do not fabricate brand assets.
4. **Declare switch mode** — cover / merge / accent-only when changing systems.
5. **Prefer refine over wipe** — recolor / resize / spacing on existing nodes first.

## Workflow
1. Style name or reference given → extract the sheet (ask only for missing slots).
2. Custom brand → ask the shortest questions to fill the sheet.
3. Lock sheet as hard constraints; paint against it.
4. Switching style → declare **cover / merge / accent-only**, then recolor systematically.
5. Self-check: one palette mood, one type mood across the board.

## Parameter sheet (fill before paint)
| Slot | Capture |
|------|---------|
| Tone | One sentence (calm engineering / warm editorial / …) |
| Colors | Primary / secondary / accent as **roles** + sample hex |
| Type | Display + body; weight ladder |
| Radius / stroke | Shared scale |
| Spacing | Base step (4 or 8) |
| Surfaces | Border? Shadow? Flat vs elevated |
| Forbidden | Explicit anti-patterns for this brand |

## Apply on canvas
| Sheet slot | How |
|------------|-----|
| Color roles | Map to fills/strokes; keep text on readable surfaces |
| Type scale | Jump sizes per sheet; no second display face mid-run |
| Radius/stroke | Shared on cards/buttons/inputs |
| Spacing | Gaps and padding from base step |
| Cover switch | Replace palette/type systematically |
| Merge switch | Keep structure, swap roles |
| Accent-only | Touch primary/CTA only; leave neutrals |

## Do not
- Invent logos, slogans, or trademark marks
- Introduce a competing second palette mid-run without declaring switch mode
- Wipe the board when a recolor pass would suffice

## Related
`garden_style` (taste), `shadcn_ui` (control grammar).

## Done when
One coherent sheet visible across the artboard; no competing second palette or type mood.
