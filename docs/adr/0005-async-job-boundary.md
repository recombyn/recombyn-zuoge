# ADR 0005: Async job boundary (Celery + Redis poll)

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Long-running work (file import, image hydrate, artboard export/render) must not block FastAPI request workers. We already enqueue **import** via Celery + Redis job records. Design Agent image hydrate still runs inside the LangGraph / `/design/run` SSE request and can stall the stream for up to ~90s.

## Decision

1. **Queue:** Celery + Redis broker/result (existing `worker.celery_app`).
2. **Job record:** Redis JSON via `app.services.job_store` with kind prefix `{kind}_job:{id}` (import, hydrate, …), TTL `job_ttl_seconds`.
3. **Client contract (v1):** enqueue + poll (same shape as import):
   - `POST …/jobs` → `{ job_id, status: "queued" }`
   - `GET …/jobs/{id}` → `{ job_id, status, progress, result?, error? }`
   - Status: `queued | processing | done | failed`
4. **Progress streaming:** keep Design Agent SSE for interactive agent turns; **do not** invent a second SSE protocol for hydrate v1. Optional later: SSE `hydrate_progress` if poll UX is insufficient.
5. **First verticals:** hydrate (`POST/GET /api/v1/design/hydrate/jobs`), export (`POST/GET /api/v1/design/export/jobs` + `/file`), and interactive media gen (`POST/GET /api/v1/chat/{image,video,audio}/jobs`). Export rasterizes stored artboards (background + rects + images + wrapped scene text) — not a full canvas-engine replay; interactive canvas export stays in the browser. Sync `POST /chat/{image,video,audio}` remain convenience endpoints for scripts; the editor uses jobs so API workers are not held for provider latency.
6. **Retry / metrics / DLQ:** hydrate and export tasks use Celery `autoretry_for` on transient `ConnectionError` / `TimeoutError` / `OSError` (max 2, backoff). Counters `recombyn_hydrate_jobs_total{event}` / `recombyn_export_jobs_total{event}` / `recombyn_{image,video,audio}_jobs_total{event}` (`enqueued|done|failed|retry|dlq`). Terminal hydrate/export failures `LPUSH` Redis lists `recombyn:dlq:hydrate` / `recombyn:dlq:export` (+ `*_dlq_total`, gauges `*_dlq_depth`). Admin replay: `GET/POST/DELETE /api/v1/admin/ops/hydrate-dlq` and `/export-dlq`. Chat media jobs fail in place (no DLQ) — provider errors are not ops-replayable.
7. **Progress:** job records expose `progress` for poll. Design Agent hydrate emits `activity` SSE (`task_id`, percent) on the existing agent stream — no second SSE protocol.
8. **Local DX:** `npm run dev:worker` starts Celery (`--pool=solo` on Windows). Settings: `design_image_hydrate_async`, `design_image_hydrate_queue_stall_sec`.

## Consequences

### Positive

- Unblocks API/agent request threads for image generation.
- Reuses proven import job pattern; low new surface area.

### Negative / trade-offs

- Requires Redis + worker process locally (document clearly).
- Poll UX for export/image jobs; Design Agent hydrate progress rides the existing SSE.

## Alternatives considered

1. **Only SSE for hydrate** — rejected for v1; couples FE and job lifecycle too early.
2. **In-process asyncio background tasks** — rejected for multi-worker deploy (lost on restart).
3. **Separate hydrate process** — not needed; jobs stay in the API worker (ADR 0004).

## References

- `apps/api/app/api/routes/import_jobs.py`
- `apps/api/worker/tasks.py`
- [Roadmap Phase 2](../roadmap/platform.md)
