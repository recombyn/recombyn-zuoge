# 分层服务目录结构

```
src/
├── image_layer_pipeline/          # 算法内核（无 HTTP）
│   ├── pipeline.py                # 五步编排
│   ├── stages/                    # 按步骤拆分
│   │   ├── depth.py
│   │   ├── segmentation.py
│   │   ├── mask_ops.py
│   │   ├── export_psd.py
│   │   └── inpainting/
│   ├── routing/                   # 场景路由（LaMa / Flux）
│   └── types.py
│
└── recombyn_intelligence_service/
    └── vision/                    # HTTP API
        ├── routes/                # 路由层
        ├── services/              # 业务编排
        └── infra/                 # Job 存储 / 执行 / SSE
```

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/pipeline/jobs` | 完整分层 |
| GET | `/api/v1/pipeline/jobs/{id}` | 任务状态 |
| POST | `/api/v1/pipeline/segment` | 工业抠图 |
| POST | `/api/v1/pipeline/text-decompose` | editText：OCR + LaMa 背景 |
| POST | `/api/v1/pipeline/detect-regions` | Mark 工具：文字框 + 主体框 |
| POST | `/api/v1/pipeline/analyze-pages` | 文档导入：OCR/layout + 色板 |
| POST | `/api/v1/pipeline/inpaint` | 无状态 LaMa 补背景 |
| POST | `/api/v1/pipeline/jobs/{id}/refine/*` | 精修 |
| GET | `/health` | 服务 + 队列 + Flux + **vision.models** 商用权重状态 |

## 队列（Phase 2）

默认：API 内 `ThreadPoolExecutor`（`ILP_MAX_JOB_WORKERS`）。

启用 Celery + Redis：

```bash
pip install -e ".[queue]"
docker compose --profile queue up -d --build
# 或本地：
ILP_USE_CELERY=true ILP_REDIS_URL=redis://127.0.0.1:6379/0 \
  celery -A recombyn_intelligence_service.vision.infra.celery_app:celery_app worker -l info
```

## 商用权重

见 [commercial-models.md](commercial-models.md)。`GET /health` 在权重缺失时返回 `status=degraded` 与 `production_blocker`。

Vision 积分底价：`billing/vision_pricing.py`，`POST /billing/quote` 传 `mode=removeBg` 等。

`configs/routing.yaml` 中 `flux_enabled: true` 且修复 mask 面积超过阈值时，若配置了 `FAL_KEY` 则走远程 Flux fill，否则回退 LaMa。

## editText OCR（可选）

`text-decompose` / `detect-regions` 需要 PaddleOCR：

```bash
pip install -e ".[ocr]"
# PaddlePaddle 需按平台单独安装，见 paddlepaddle 官网
```

Docker 镜像默认已安装 `.[queue,ocr]`（见仓库根 `Dockerfile`）。

配置：`configs/image_layer_default.yaml` + `configs/routing.yaml`
