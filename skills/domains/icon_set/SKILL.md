# Icon / mark set

Craft for **图标 / icon set / favicon / UI glyph** — one system. Default to vector for simple marks; use bitmap only when texture/brand detail cannot stay crisp as geometry.

## Design thinking

| Ask | Aim |
|-----|-----|
| **Deliverable** | App icon / UI glyph set / favicon |
| **System** | Shared optical size, stroke, corner, filled vs outline |
| **Grid** | Same cell (e.g. 64 / 96 / 128); columns × rows |
| **Bitmap vs vector** | Simple silhouettes / outline-filled glyphs → vector. Textured or complex brand marks the user asked for → bitmap. Soft-avoid emoji-as-icon |
| **Scale** | Still readable ~32px for UI glyphs |

Quality bar: **intentional design** — one language across the set, even optical weight. Soft-avoid rainbow-per-mark.

## Composition

- Lock cell size and sheet grid (e.g. 4×2).
- State the system in one line (stroke / corner / mono ink).
- Optical balance: rounds slightly large, squares slightly tight.
- Optional small labels under marks — labels never replace glyphs.

## Vector vs image

| Ask | Prefer |
|-----|--------|
| App icon / UI set / favicon | Vector silhouette that survives small sizes |
| Textured brand mark (user asked) | Bitmap via `image_gen` |
| Static mark | Vector — soft-avoid Lottie unless motion is asked |

Budget: one solid/outline glyph per mark — not stroke piles. Soft-avoid pictograph characters or lone text characters as the icon.

## Honesty

Unless the user provides them, avoid inventing board facts such as brand logos or trademark marks.

## Place on board

Draw each simple mark as real geometry; then optional labels. Load `image_gen` only for textured/complex marks the user requested.

## Related

`mobile_app_ui`, `dashboard_ui`, `shadcn_ui`, `image_gen`, `motion_animation` (motion only)

## Done when

N marks ≈ N real glyphs (or intentional bitmap marks); one system language; labels readable.
