# Layout (craft)

Spacing, grid, alignment, whitespace. `composition` owns the **archetype**; this skill owns **execution**.

## Hard rules

1. Spacing from one base step (4 or 8). No random 13/16/15 margins.
2. Keep empty space. Posters: ≥15% unless the user asked dense. UI: consistent inset, not edge-hugging chrome.
3. Align to a grid or a shared edge. Prefer `align_nodes` / `distribute_nodes` over eyeballing.
4. Do not default to three equal columns / four equal KPI tiles. Unequal columns are allowed when the archetype says so.
5. One primary band (hero or main task). Secondary blocks recede.

## Rhythm

```text
XS SM MD LG XL XXL   ← from design_system tokens
inset ≥ MD on posters
UI gutter from the same scale
```

## Checklist

- [ ] Same scale on all sides of a group
- [ ] Not every edge crowded
- [ ] Alignment is intentional, not centered-everything
