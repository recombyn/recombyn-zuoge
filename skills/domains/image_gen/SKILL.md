# Image generation (Skill V3)

This skill is **not** “generate a pretty picture”.
It is a plate that executes the brief. Overlay type stays on the board (`create_text`).
Kernel still Decide → Paint → Observe → Review. This skill owns **how the bitmap is specified**.

Helper: may load **with** a surface (`poster_craft` / `landing_page` / …). It does not replace them.

## Process (mandatory order)

```text
DESIGN BRIEF
 → VISUAL THESIS
 → COMPOSITION
 → MATERIAL
 → LIGHTING
 → IMAGE
```

Do not jump to a prompt until thesis, crop, material, and light are named.

## 1. Brief → thesis

Reuse P0 `design_brief`. The image must argue `visual_thesis` and show `visual_hero`.
Style DNA (`material` / `lighting` / `imagery`) is the prompt spine — not “cinematic, 8k, masterpiece”.

## 2. Composition (in the plate)

Pick crop and focal **before** generating:

- What is in frame vs left to overlay type / vector chrome
- One primary subject; quiet bands where titles will sit
- Camera: distance, angle, what is cut off

If the board composition is `center_hero`, the plate should not also scream a second hero in the corner.

## 3. Material → lighting → image

Name both in the prompt (from Style DNA):

| Slot | Ask |
|------|-----|
| Material | jade / aged steel / paper / cloth / skin / glass / … |
| Lighting | direction, hardness, color of light, what it reveals |
| Medium | photo / illustration / grain print / quiet 3D — **one** |

Then emit `create_image` (hydrate). Simple geometry that stays crisp may stay vector instead — crude shape piles are not atmosphere.

## 4. Forbidden: baked title

**Do not** render titles, slogans, watermarks, or UI chrome **inside** the bitmap
unless the user **explicitly** asks for text in the picture (lettering-as-image, packaging, neon sign, 书法字形).

Default: overlay catalog type on a quiet band. Lettering plates are the exception, not the habit.

## 5. Honesty

Unless the user asks, do not invent logos, prices, phones, or readable fake copy in the pixels.

## 6. Cutout vs full-bleed

- Full-bleed atmosphere: keep the plate; type sits on quiet zones.
- Product / lettering on a colored board: **cutout** so no leftover white box.

## Hard rules

1. Brief + thesis before generate.
2. Composition + material + lighting in the prompt — not style-spam adjectives.
3. No baked titles unless explicitly requested.
4. Anti-slop: unjustified purple-blue glass postcard heroes fail Review.

## Done when

- Plate matches thesis at a glance (subject + material + light)
- Room for overlay type (or user-requested in-image lettering only)
- No invented on-image copy

## Related

Surfaces via Decide (`poster_craft`, `landing_page`, `banner_ad`, …) · `icon_set` for many marks · foundations via `extends`
