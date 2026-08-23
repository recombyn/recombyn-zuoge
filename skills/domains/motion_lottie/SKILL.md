# Motion / Lottie

Craft for **Lottie / 动效 / UI motion** — calm, purposeful loops and one-shots. Static simple marks stay vector; complex still scenes use image; motion only when it has a job.

## Design thinking

| Ask | Aim |
|-----|-----|
| **Is motion needed?** | Explicit Lottie / 动效 / loading ask — otherwise skip |
| **Job** | Loading / success / empty idle / like / tip pulse |
| **Focus** | 1–2 movers; calm ease |
| **Fit** | Style matches surrounding UI tokens |
| **Bitmap vs vector vs motion** | Simple static marks → vector. Complex still atmosphere → bitmap. Motion only when the brief asks for it |

Quality bar: **intentional design** — purpose reads in ~1s. Soft-avoid strobe, rainbow flicker, and animating every chrome piece.

## Recipes & composition

| Intent | Lean |
|--------|------|
| Loading | Calm cyclic spinner/dots |
| Success | Short settle; often non-loop |
| Empty | Low-amplitude idle |
| Like | Short accent pop |
| Tip | Soft pulse on one affordance |

Place at a sensible UI size (often ~≥44px feel when interactive-adjacent). Soft-avoid oversized motion covering primary copy.

## Prompt cues

Say: **what moves**, **loop vs one-shot**, **tempo**, **style**, **colors**, **purpose**.

## When another medium fits better

| Need | Prefer |
|------|--------|
| Static simple icon / logo mark | Vector / `icon_set` |
| Complex still poster / atmosphere | `poster_craft` + `image_gen` |

## Honesty

Unless the user provides them, avoid inventing board facts such as brand mascots or logos inside the motion.

## Place on board

Confirm motion → place → generate from a tight brief → refine size/position in place when layout-only.

## Related

`icon_set`, `mobile_app_ui`, `shadcn_ui`, `poster_craft`, `image_gen`

## Done when

Purpose is clear quickly; 1–2 movers; loop/one-shot matches the job; colors agree with UI.
