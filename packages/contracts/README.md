# @recombyn/contracts

Web 客户端用的 OpenAPI → oRPC 契约（`OpenAPILink` + TanStack Query）。API 跑着或能离线导出 OpenAPI 时，从仓库根执行 `npm run gen:contracts`。

## Generate

1. API running on `http://127.0.0.1:8000` (or set `OPENAPI_URL`), **or** a working `apps/api` Python env for offline export.
2. From repo root:

```bash
npm run gen:contracts
```

Writes:
- `openapi/api-openapi.json` (paths stripped of `/api/v1`)
- `generated/api/orpc.gen.ts` + `zod.gen.ts`

Commit `generated/` so web builds without a live API.
