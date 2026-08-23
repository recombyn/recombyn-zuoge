# Typography (craft)

Type ladder and placement. Token **sizes** live in `design_system`; this skill owns **how type behaves**.

## Hard rules

1. One type mood for the board. Roles: H1 > H2 > body > caption — jumps must be visible.
2. Prefer **overlay** `create_text` on a quiet band. Bake lettering into a bitmap only when the user asks for display lettering.
3. Language matches the user. Do not mix a second display face mid-run.
4. CTA / meta ≤ 1 line of action copy. Do not invent slogans.
5. Pairing: one display + one text, or one family with weight contrast. Catalog faces only.

## Ratios (defaults; override from tokens)

```text
Poster H1 : body     ≈ 3–4 : 1
UI H1 : body         ≈ 1.6–2.2 : 1
Line-length          40–70 characters for body
```

## Checklist

- [ ] Title is a text node, not pixels (unless asked)
- [ ] Ladder readable at 50% zoom
- [ ] No emoji-as-icon in titles
