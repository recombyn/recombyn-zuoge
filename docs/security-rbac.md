# RBAC & authorization

Who can do what. Coarse roles (`user` / `admin`) plus resource×action helpers. Living notes for the next increment.

## Today

| Principal | How | Can do |
|-----------|-----|--------|
| Anonymous | No Bearer | Public project cover thumbs only; health/docs |
| `user` | `CurrentUser` | Own projects, uploads under `uploads/{user_id}/`, wallet, Design Agent |
| `admin` | `AdminUser` / `is_admin_user` | Admin catalog, design skills, metrics, bootstrap email/id |

### Resource×action helpers (`app.api.deps`)

| API | Meaning |
|-----|---------|
| `user_has_permission(user, "admin:users:write")` | Deny-by-default matrix check |
| `Depends(require_permission("admin:users:write"))` | FastAPI dependency |
| `audit_admin_mutation(...)` | Structured admin write log (`recombyn.audit` + `trace_id`) |

Shipped admin permission strings:

- `admin:users:read` / `admin:users:write`
- `admin:plaza:moderate`
- `admin:catalog:write` / `admin:design:write` / `admin:fonts:write`
- `admin:content:read` / `admin:notices:write` / `admin:metrics:read`

Ops: `GET /admin/ops/hydrate-dlq` and `GET /admin/ops/export-dlq` use `admin:metrics:read`; replay/discard use `admin:design:write`.

End-user permissions today: `project:read` / `project:write` / `upload:write` / `wallet:read`.

### Example: `PATCH /admin/users/{id}` uses `require_permission("admin:users:write")`.

All `/api/v1/admin/**` mutating methods (POST/PUT/PATCH/DELETE) emit `admin_audit` lines via router dependency `audit_admin_writes` (success only).

### Org roles (skeleton)

Tables `orgs` / `org_members` (Alembic `0006_org_members`). Roles: `owner` > `admin` > `member`.

| Helper | Meaning |
|--------|---------|
| `get_org_member_role` / `create_org` / `upsert_org_member` | `app.services.auth.orgs` |
| `user_has_org_permission` / `require_org_permission` | `app.api.deps` |

Org permissions: `org:project:*`, `org:members:write`, `org:settings:write`, `org:billing:*`. Platform `admin` bypasses org checks.

## Incremental next steps

1. Wire org_id onto projects and expose org admin HTTP routes.
2. Prefer deny-by-default helpers next to the owning router (in-file).
3. Expand product UI for team invites.

## Process

- Security reports: [SECURITY.md](../SECURITY.md)
- Architecture boundaries: [ADR 0004](./adr/0004-modular-monolith-first.md)
- Upload content policy: [ADR 0008](./adr/0008-upload-content-validation.md)
