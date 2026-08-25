# Commercial vision model weights — deploy checklist

Intelligence vision features need ONNX / optional SAM weights on the host volume.
Use the setup script to verify readiness before going live.

## Quick check

```bash
python scripts/setup_commercial_models.py --check
```

Exit `0` when OCR + Real-ESRGAN (or dev Lanczos flag) are ready.  
Exit `1` prints `production_blocker` — fix before production.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `ILP_ESRGAN_MODEL_PATH` | Real-ESRGAN x4 ONNX (upscale) |
| `ILP_MATTING_ONNX` | BiRefNet HR-matting ONNX — **default precision weights for all cutouts** |
| `ILP_HR_MATTING_ONNX` | Alias for HR-matting ONNX path |
| `U2NET_HOME` | rembg model cache directory |
| `ILP_ESRGAN_DOWNLOAD_URL` | Optional CI/CD download URL for setup script |
| `ILP_UPSCALE_ALLOW_LANCZOS=1` | **Dev only** — allow Lanczos fallback without ONNX |
| `ILP_EDGESAM_ENCODER_PATH` | EdgeSAM encoder ONNX |
| `ILP_EDGESAM_DECODER_PATH` | EdgeSAM decoder ONNX |
| `ILP_EDGESAM_ENCODER_URL` / `ILP_EDGESAM_DECODER_URL` | Optional download URLs |
| `ILP_SAM_BACKEND` | `auto` \| `edgesam` \| `fastsam` \| `opencv` \| `off` |
| `ILP_DISABLE_SAM_ROI=1` | Skip SAM proposals (faster, lower Mark quality) |
| `INTELLIGENCE_SERVICE_API_KEY` | Bearer token for all `/api/v1/pipeline/*` routes |
| `INTELLIGENCE_PRODUCTION=1` | Fail startup if API key missing |

## Recommended layout

```text
models/
  RealESRGAN_x4plus.onnx
  edgesam_encoder.onnx
  edgesam_decoder.onnx
  FastSAM-s.pt          # optional, ultralytics
```

## Setup commands

```bash
# Verify / download (set *_URL env vars in CI or paste weights manually)
python scripts/setup_commercial_models.py --esrgan --edgesam --check

# Optional FastSAM (Mark / segment ROI proposals)
pip install -e ".[sam]"
# Place FastSAM-s.pt under models/ or set ultralytics default cache
```

## EdgeSAM export (manual)

EdgeSAM weights are not redistributed in this repo. Export ONNX from the upstream
EdgeSAM project, then point:

```text
ILP_EDGESAM_ENCODER_PATH=/data/models/edgesam_encoder.onnx
ILP_EDGESAM_DECODER_PATH=/data/models/edgesam_decoder.onnx
```

Without EdgeSAM/FastSAM, SAM ROI falls back to OpenCV GrabCut (always available).

## BiRefNet HR-matting (通用高精抠图)

Production cutout uses one general path. Place HR-matting ONNX (~1 GB) for best edge quality
(hair, glass, product — all same model):

```bash
python scripts/setup_commercial_models.py --hr-matting
# or manually (GitHub rembg release — may be slow/blocked in CN):
# curl -L -o models/BiRefNet_HR-matting-epoch_135.onnx \
#   https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet_HR-matting-epoch_135.onnx
#
# Hugging Face mirrors (recommended when GitHub resets):
#   https://huggingface.co/emrikol/birefnet-matting-onnx/resolve/main/birefnet-matting.onnx
#   https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model.onnx  (~224MB lighter)
export ILP_MATTING_ONNX=/data/models/BiRefNet_HR-matting-epoch_135.onnx
```

Without it, the stack falls back to rembg `birefnet-general` (auto-downloaded on first run).

Benchmark compare variants:

```bash
python scripts/benchmark_matting.py --golden-dir private-eval/matting/golden \
  --variants auto,general,hr-matting
```

## Real-ESRGAN

```bash
python scripts/setup_commercial_models.py --esrgan
# Default URL: https://huggingface.co/Meeperomi/RealESRGAN_x4-onnx/resolve/main/RealESRGAN_x4.onnx
export ILP_ESRGAN_MODEL_PATH=/data/models/RealESRGAN_x4plus.onnx
```

Or place [RealESRGAN_x4plus.onnx](https://github.com/xinntao/Real-ESRGAN) on disk / set
`ILP_ESRGAN_DOWNLOAD_URL` for automated fetch in your deploy pipeline.

## Health endpoint

`GET /health` returns `vision.models` and `production_blocker`.  
`status=degraded` means the service runs but commercial weights are incomplete.

## Docker compose

Mount a volume at `/data` and set:

```yaml
environment:
  INTELLIGENCE_DATA_DIR: /data
  ILP_ESRGAN_MODEL_PATH: /data/models/RealESRGAN_x4plus.onnx
  INTELLIGENCE_SERVICE_API_KEY: ${INTELLIGENCE_SERVICE_API_KEY}
  INTELLIGENCE_PRODUCTION: "1"
volumes:
  - intelligence_data:/data
```

## Vision billing

BFF charges wallet credits when Intelligence is enabled (see `apps/api` `image_tools` route).
Quote floors are defined in `billing/vision_pricing.py` and exposed via
`POST /billing/quote` with `mode` = `removeBg`, `vision_removeBg`, etc.
