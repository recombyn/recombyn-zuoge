# Landing / website (Skill V3)

Deliverable: **落地页 / 官网 / landing / marketing homepage**.
Kernel still Decide → Paint → Observe → Review. This skill owns **family + section IA**.
Inherit craft from `extends` — do not invent a second aesthetic curriculum.

## Process (mandatory order)

```text
INPUT
 → FAMILY         (SaaS | AI | Consumer | Editorial | Portfolio | Commerce)
 → BRIEF          (P0 design_brief fields)
 → ART DIRECTION  (visual_thesis + style DNA)
 → SECTION PLAN   (family flow — not a card grid)
 → DESIGN SYSTEM  (tokens / type ladder)
 → EXECUTION      (paint ops — hero first, then proof)
 → OBSERVE        (host geometry facts only)
 → REVIEW         (scores; Runtime totals)
 → CORRECTION     (fix toward brief + subtraction)
 → FINAL
```

## 0. Classify family first

Pick **one**. Do not mix SaaS pricing chrome onto an editorial magazine.

| Family | Default job |
|--------|-------------|
| SaaS | Convert a buyer who needs proof, then a path |
| AI | Show input → model → output; demo before features |
| Consumer | Desire + product truth; photos over icon grids |
| Editorial | Story lead; hierarchy of articles, not product cards |
| Portfolio | Selected work with contrast; not six equal thumbnails |
| Commerce | Product + offer honesty; price only if the user gave it |

If the prompt is ambiguous, prefer the family that matches **the primary verb** (subscribe / generate / buy / read / hire), and write it into `design_brief.purpose`.

## 1. Brief (P0)

Same P0 as `design_brief`. Landing extras:

- `visual_hero` = the first-screen subject (product UI, photo, wordmark+claim — one)
- `composition.archetype` = `left_text_right_visual` · `center_hero` · `editorial` · `split` · `bottom_cta` (pick one)
- `avoid` must include the generic landing template if not requested

## 2. Section flows (do not skip)

### SaaS

```text
Hero → Product Proof → Problem → Solution → Workflow → Trust → Pricing → CTA
```

Proof before a feature grid. Pricing only with user-supplied tiers.

### AI

```text
Hero → Live Demo → Input → AI → Output → Use Cases → Trust → CTA
```

The demo is the product. Do not replace it with three capability cards.

### Consumer

```text
Hero (desire) → Product truth → How it feels → Social proof → Offer → CTA
```

### Editorial

```text
Masthead → Lead story → Supporting pieces → Quote / essay → Subscribe CTA
```

### Portfolio

```text
Identity → Featured work (1–2) → Supporting work → Process → Contact
```

### Commerce

```text
Hero product → Proof → Benefits (uneven, not a trio) → Offer → Trust → CTA
```

## 3. Forbidden default

Never start from:

```text
Hero
3 cards
3 cards
Logo
CTA
```

That template is an `anti_slop` hit (`three_card_layout` / `generic_hero`) unless the brief explicitly asks for three equal benefits.

## 4. Composition / responsive

- Desktop board ~1440×900+ (grow height with sections). Mobile ~390×844+ via `responsive`.
- One primary CTA; secondaries quieter.
- Nav is a mark + few links — not a second hero.
- Empty space between sections ≥ a type line; do not pack every band.

## 5. Execution stack

1. `create_frame` (desktop or mobile primary)
2. Hero: claim + visual (bitmap via `image_gen` when atmosphere/product shot needs it)
3. Family sections in order — vector chrome for rules/cards; bitmap for rich scenes
4. One CTA band
5. **Second pass = subtract / align — not add another card row**

## 6. Honesty

Unless the user provides them, do not invent logos, testimonials, prices, review counts, or fake company names.

## Hard rules

1. Family before sections. Brief P0 before paint.
2. One thesis, one primary CTA, one first-screen focal.
3. Anti-slop: no unjustified 3-card / glass / purple-blue hero.
4. Subtraction pass when Review score 70–89.

## Done when

- Family flow is recognizable (not a generic card stack)
- Hero job obvious in ~2s; CTA unique
- Review total ≥ 90 (Runtime) with no blocker / slop hits

## Related

`image_gen` (hero/product bitmaps) · `icon_set` / `shadcn_ui` only when dense UI chrome is needed · foundations via `extends`
