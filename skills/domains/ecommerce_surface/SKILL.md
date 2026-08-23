# Ecommerce surfaces

Craft for **电商主图 / product hero** and **商详 / PDP** — product first, modules clear, commerce facts honest.

## Design thinking

| Ask | Aim |
|-----|-----|
| **Surface** | Hero card vs tall PDP |
| **Hero** | Product owns ~40–60% visual weight |
| **Tone** | Clean retail / soft lifestyle / luxury sparse — one only |
| **Bitmap vs vector** | Product / lifestyle complexity → bitmap. Simple badge frames, benefit icons, dividers → vector |
| **Facts** | Commerce numbers only from the user |
| **Ratio** | 1:1 / 3:4 / tall as asked |

Quality bar: **intentional design** — product unmistakable; modules scannable. Soft-avoid burying the SKU under chrome.

## Surface recipes

| Surface | Feel | Job |
|---------|------|-----|
| **Hero** | ~1:1 or platform size | Subject largest; sparse badges |
| **PDP** | Tall / sections | hero → title/price → benefits → specs → story → CTA |

## Type & modules

- Title clear of the face; price/promo only when provided.
- Benefits: 3–5 short lines; specs as aligned label/value.
- One accent for CTA/price; neutrals elsewhere.

## Vector vs image

| Prefer vector when | Prefer bitmap when |
|--------------------|--------------------|
| Benefit icons, thin rules, card frames | Product photo / detailed hero |
| Sparse badge outlines | Lifestyle scene that vectors cannot carry |

Real geometry for marks (`icon_set` when many); soft-avoid emoji as icons.

## Honesty

Unless the user provides them, avoid inventing board facts such as prices, discounts, review counts, sold numbers, phone numbers, logos, etc.

## Place on board

Load **`image_gen`** for product plates, titles, and cutouts.

Typical stack: product cutout → vector module chrome → title/price → benefits → CTA.

## Related

`image_gen`, `icon_set`, `shadcn_ui` (buy-box chrome only)

## Done when

Product reads at a glance; modules clear; medium matches complexity; language matches the user.
