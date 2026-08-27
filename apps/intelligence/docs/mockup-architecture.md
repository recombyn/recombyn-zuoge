# Industrial Mockup System (2.5D PBR)

Closed-source product mockup rendering for Recombyn Intelligence.

## Architecture

```
[Offline bake]  photo + mask ──> bake_mockup_template_from_photo() ──> .mockup bundle
[Online render] design RGBA ──> TPS UV + normal displacement + PBR composite ──> PNG/PSD
[Batch]         N designs   ──> render/batch or jobs/batch (Celery)
```

### Five+ channel asset kit

| Channel | File | Blend |
|---------|------|-------|
| Albedo backdrop | `base.png` | under |
| UV warp grid | `uv.npy` | bicubic remap |
| Printable mask | `mask.png` | alpha |
| Diffuse shadow | `shadow.png` | multiply |
| Specular highlight | `highlight.png` | screen |
| Env reflection | `env.png` | add (rim) |
| Normal map | `normal.png` | UV perturb |
| TPS landmarks | `tps_xy.npy`, `tps_uv.npy` | non-rigid UV |
| Displacement | `displacement.npy` | UV offset |

### PBR composite (linear light)

$$\text{lit} = \text{screen}(\text{design} \times \text{shadow}, \text{highlight}) + \text{env} \cdot \text{fresnel}$$

Fresnel + transparency for glass templates (`demo-glass`).

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/mockup/templates` | List templates |
| POST | `/api/v1/mockup/render` | Single PNG render |
| POST | `/api/v1/mockup/render/psd` | Layered PSD export |
| POST | `/api/v1/mockup/render/batch` | Sync batch (≤64) |
| POST | `/api/v1/mockup/jobs/batch` | Async batch job |
| GET | `/api/v1/mockup/jobs/{id}` | Poll batch job |
| POST | `/api/v1/mockup/bake` | Bake template from photo+mask |

## Builtin templates

- `demo-cylinder` — TPS mug, normal + env reflection
- `demo-glass` — Fresnel transparency glass cylinder

## Queue (optional)

```bash
MOCKUP_USE_CELERY=true MOCKUP_REDIS_URL=redis://127.0.0.1:6379/1 \
  celery -A recombyn_intelligence_service.mockup.infra.celery_app:celery_app worker -l info
```

## Color management

Linear sRGB compositing + ACES tonemap. Optional ICC via `MOCKUP_ICC_INPUT` / `MOCKUP_ICC_OUTPUT` on renderer.

## Tests

```bash
pytest tests/unit/test_mockup_renderer.py -q
```
