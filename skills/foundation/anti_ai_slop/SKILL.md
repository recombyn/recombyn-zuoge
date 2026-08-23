# Anti AI Slop (qa)

Detect generic “AI taste” defaults. **Not absolute bans.**

## Hard rules

Treat each hit as a **risk** unless `design_brief.avoid` or thesis/DNA explicitly justifies it:

- `glassmorphism`
- `purple_blue_gradient`
- `excessive_rounding`
- `three_card_layout`
- `random_particles`
- `floating_3d_objects`
- `excessive_shadows`
- `pill_overuse`
- `center_everything`
- `generic_hero`
- `decorative_noise`

### Gate

```text
hit AND no brief justification → anti_slop_hits + must_fix risk
hit AND brief justifies (e.g. user asked glass) → note only, not automatic fail
```

## Subtraction

Prefer remove/merge over add when slop appears.

## Checklist

- [ ] Review lists concrete `anti_slop_hits` (or empty if clean)
- [ ] Unjustified hits block pass even at high scores
- [ ] Justified hits cited against brief
