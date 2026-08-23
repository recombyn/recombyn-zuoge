# Design System (foundation)

Tokens + ratios. Paint against the sheet.

Type **behavior** lives in `typography`; color **roles** live in `color` (this pack `extends` both). This skill owns the **numbers**.

## Process

```text
… → LAYOUT PLAN → DESIGN SYSTEM (this skill) → EXECUTION → …
```

## Hard rules

1. Emit `design_brief.tokens` (and/or `typography` / `palette`) when P1 is known.
2. Prefer **roles** (primary / surface / muted / accent) over scattered hex.
3. Hierarchy must jump — e.g. H1:body ≈ 3–4:1 for posters; clear H1 > H2 > body > caption.
4. Spacing from a base step (4 or 8). No 13/16/15 random margins.
5. One radius scale (sm/md/lg). One type mood for the board.
6. If `awesome_design_md` / brand sheet is loaded — that sheet is law for this run.

## Minimal token sheet

```text
Typography: H1 / H2 / H3 / Body / Caption
Spacing: XS SM MD LG XL XXL
Radius: SM MD LG
Colors: Primary Secondary Surface Muted Accent
Grid: columns + max width (UI surfaces)
```

## Ratios matter more than absolute sizes

```text
Hero title : body  ≈ 3.5 : 1
Primary : secondary area ≈ 1.0 : 0.6
Hero : supporting ≈ 70 : 30
```

## Checklist

- [ ] No random per-node sizes
- [ ] Visible type ladder
- [ ] ≤1 accent family; accent area restrained
