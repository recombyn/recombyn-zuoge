# Banner / ad strip

Craft for **横幅 / banner / 通栏 / 顶通 / KV banner** — one claim strip, not a landing page.

## Design thinking

| Ask | Aim |
|-----|-----|
| **Job** | One claim + one CTA a glance can catch |
| **Tone** | One direction — clean promo, bold retail, quiet luxury, etc. |
| **Split** | Where subject lives vs where type lives |
| **Bitmap vs vector** | Simple geometry / flat marks → vector. Rich atmosphere / product photo → bitmap. If vectors look crude, use image |
| **Crop risk** | Mid-band safer; edges may clip (~5–8%) |
| **Size** | e.g. 1920×400 / 1200×628 / 750×300 / 1080×540 or user WxH |

Quality bar: **intentional design** — claim readable, CTA obvious, crop-aware. Soft-avoid generic AI postcard fills.

## Layout recipes

| Format | Split |
|--------|-------|
| Wide web | Subject \| copy+CTA, or full bleed + quiet band |
| Tall mobile | Subject → claim → CTA |
| Square social | Center claim; subject as atmosphere |

## Type & CTA

- One primary claim; ≤1 supporting line, clearly smaller.
- One primary CTA — high contrast, not flush to the edge.
- Catalog text or lettering plate via `image_gen` when fonts fall short.

## Vector vs image

Simple frames, dividers, dots, flat CTA plates → vector. Complex product/scene → `image_gen`. Soft-avoid emoji spam and multi-section landing sprawl on one strip.

## Honesty

Unless the user provides them, avoid inventing board facts such as logos, prices, phone numbers, etc.

## Place on board

Load **`image_gen`** for atmosphere / product / title plates and stack.

Typical stack: background → subject → structure/marks → claim → CTA.

## Related

`image_gen`, `garden_style`

## Done when

Far: claim + CTA clear. Near: mid-band safe; medium matches complexity; language matches the user.
