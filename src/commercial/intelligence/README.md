# recombyn-intelligence

> **Monorepo location:** `src/commercial/intelligence` in [recombyn-dev](https://github.com/recombyn/recombyn-dev).  
> The standalone `recombyn/recombyn-intelligence` repo is deprecated; develop here only.

Internal Design Intelligence HTTP service for Recombyn Cloud.

Implements `POST /v1/{method}` expected by the product Runtime remote client.
Empty `{}` → host Runtime uses its local fallback provider.

## Contract dependency

Depends on wire package `recombyn-protocol>=0.1.3` (method names, aliases,
request fields, usable-response rules, Billing Protocol schemas).

Private **billing brain** (not in open Runtime):

```text
GET/PUT /billing/commercial   # MarginEngine + plan entitlements (Admin)
POST    /billing/quote        # Runtime-safe credits only (no margin leak)
POST    /billing/cost         # internal cost breakdown (Admin/debug)
```

```bash
python scripts/bootstrap_protocol.py
# or:
# pip install -e <path-to>/packages/protocol
# pip install -e ".[dev]"
```

CI (`.github/workflows/protocol-compat.yml`) installs the pinned protocol package
and fails if any canonical method returns an unusable payload.

Triggers: push / PR / `workflow_dispatch` / `repository_dispatch`
(`protocol-changed`, payload `protocol_ref`).

## Methods

Canonical names and aliases come from `recombyn_protocol` — do not maintain a
second hand-copied list in this repo.

## Host Runtime env (consumer)

```text
RECOMBYN_INTELLIGENCE_MODE=cloud
RECOMBYN_INTELLIGENCE_URL=http://127.0.0.1:8091
RECOMBYN_INTELLIGENCE_API_KEY=dev-key
```

## Run (local)

```bash
python scripts/bootstrap_protocol.py
set INTELLIGENCE_SERVICE_API_KEY=dev-key
uvicorn recombyn_intelligence_service.app:app --host 127.0.0.1 --port 8091
```

## Run (Docker)

```bash
docker build -t recombyn-intelligence .
docker compose up -d --build
curl http://127.0.0.1:8091/health
```

The image installs `.[queue,ocr]` (Celery + PaddleOCR) for production editText / Mark.

Commercial config persists under `INTELLIGENCE_DATA_DIR` (compose volume
`intelligence_data` → `/data/commercial_config.json`). Override path with
`INTELLIGENCE_COMMERCIAL_PATH`.

Admin Margin page calls `GET/PUT /billing/commercial` and `POST /billing/cost`
with `Authorization: Bearer $INTELLIGENCE_SERVICE_API_KEY` (Admin env:
`VITE_INTELLIGENCE_API_KEY`).

## Tests

```bash
python scripts/bootstrap_protocol.py
python -m pytest tests -q
```

## Vision pipeline (depth / matting / inpaint)

HTTP routes under `/api/v1/pipeline/*` and static artifacts at `/files/outputs/{job_id}/`.

```bash
# health + queue stats
curl http://127.0.0.1:8091/health
python scripts/vision_health_check.py
```

Default job execution uses an in-process thread pool (`ILP_MAX_JOB_WORKERS`).
For Redis + Celery worker:

```bash
pip install -e ".[queue]"
docker compose --profile queue up -d --build
```

See `docs/vision-architecture.md` for directory layout, Flux routing, and API table.

Smoke test (requires service on :8091):

```bash
pip install httpx pillow   # or pip install -e ".[dev]"
python scripts/test_ilp_e2e.py --mode all
```

Endpoints: `segment`, `text-decompose`, `detect-regions`, `analyze-pages`, async `jobs` (+ refine), and **mockup** `render` / `templates`.
If `/api/v1/pipeline/segment` returns 404, restart uvicorn from this checkout.

Mockup pipeline: see [docs/mockup-architecture.md](docs/mockup-architecture.md).

Matting fine-tuning (portrait + transparent): [docs/fine-tuning-matting.md](docs/fine-tuning-matting.md).

Commercial model weights: see [docs/commercial-models.md](docs/commercial-models.md).

## Private eval

Closed rankings / datasets live under `private-eval/` (gitignored corpora).
Do not commit raw ranking CSVs or production judge prompts.

## Taste / KG

`retrieve_memory` / `write_principle` use `engines/taste_kg.py`:

- Seed principles + runtime SPO store → `data/taste/runtime_kg.json` (gitignored)
- Retrieval: hashed-ngram (default) or OpenAI-compatible `/embeddings`
- Override dir: `INTELLIGENCE_TASTE_DIR`

```text
INTELLIGENCE_EMBEDDING_BACKEND=auto
INTELLIGENCE_EMBEDDING_BASE_URL=https://api.openai.com/v1
INTELLIGENCE_EMBEDDING_API_KEY=sk-...
INTELLIGENCE_EMBEDDING_MODEL=text-embedding-3-small
```
