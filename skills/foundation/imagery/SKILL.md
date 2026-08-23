# Imagery (craft)

What the picture is for. `visual_direction` owns thesis/DNA; `image_gen` executes bitmaps. This skill owns **placement and bans**.

## Hard rules

1. One visual hero. Coverage on visual-first posters: **60–85%**. Do not run three equal photos.
2. Complex atmosphere / material / lighting → bitmap via `image_gen`. Simple marks → vector (`create_shape` / `create_icon`).
3. **No baked titles** (name, slogan, price, HUD, watermark, fake logo) unless the user asked for in-image lettering.
4. Leave a quiet band for overlay type. Do not fill every edge.
5. Prompt material + lighting, not empty adjectives (cinematic / 8k / masterpiece).

## Choose

```text
vector     marks, symbols, UI chrome, simple geometry
bitmap     hero object, space, product plate, atmosphere
none       type-led boards — do not invent a stock photo
```

## Checklist

- [ ] Hero is one subject
- [ ] Type is overlay (unless asked)
- [ ] Quiet zone reserved for copy
