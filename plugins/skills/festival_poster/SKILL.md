# Festival / holiday poster

Craft for **节日海报** — Mid-Autumn, Spring Festival / New Year, National Day, Christmas, and branded celebration KV. Atmosphere + one memorable title; keep the board honest.

## Design thinking

| Ask | Aim |
|-----|-----|
| **Festival** | Which holiday / celebration? (user-named) |
| **Tone** | Warm lantern night, crisp winter, festive red/gold, quiet moonlit, etc. — pick **one** |
| **Memory point** | Hero mood **or** dominant festival title — not both fighting |
| **Size** | Default portrait ~900×1200 unless the user specifies; roll-up uses tall hierarchy |
| **Copy** | Festival name / greeting + ≤2 support lines |

## Layout

1. Create one artboard frame first (portrait unless asked otherwise).
2. Background: theme color field and/or `create_image` hero via **`image_gen`** when the mood needs atmosphere (moon, lanterns, snowfall, fireworks) — not a pile of random shapes.
3. Title cluster centered or on a quiet band; support text smaller, generous margins.
4. Optional sparse vector accents (discs, bars) only if they reinforce the festival language.

## Tools

Prefer: `create_frame` → (`create_image` / `create_shape`) → `create_text` → `update_node` for alignment.

Load **`image_gen`** when placing bitmaps. For generic (non-holiday) posters, prefer **`poster_craft`**.

## Honesty

Do not invent prices, phone numbers, QR codes, or third-party logos unless the user provides them.

## Done when

Far: festival tone + title readable in ~1s. Near: language matches the user; margins clean; no fake brand marks.
