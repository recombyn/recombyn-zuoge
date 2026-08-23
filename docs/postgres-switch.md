# Switch to PostgreSQL

You can point the API at PostgreSQL via `DATABASE_URL`. Default self-host is **MySQL**; local dev can leave `DATABASE_URL` empty for **SQLite**. The API also accepts `postgresql://` / `postgres://`.

## What the app does

| Dialect | How |
|---------|-----|
| Empty `DATABASE_URL` | SQLite at `SQLITE_DB_PATH` (WAL + busy_timeout + write lock) |
| `mysql://…` | Existing MySQL pool; optional `DATABASE_READONLY_URL` replica |
| `postgresql://…` | psycopg pool (`pip install 'psycopg[binary]>=3.1'`); schema **not** auto-created |

Postgres `init_schema()` only **checks** that `users` exists. Migrate DDL/data first.

## Smooth switch (MySQL → Postgres)

1. Install driver: `pip install 'psycopg[binary]>=3.1'` (or `pip install -e ".[postgres]"`).
2. Provision empty database.
3. Migrate schema + data (pick one):
   - [pgloader](https://pgloader.readthedocs.io/): `pgloader mysql://… postgresql://…`
   - `mysqldump` → edit types → `psql`
   - Cloud DMS / logical replication
4. Point env:

```env
DATABASE_URL=postgresql://user:pass@host:5432/recombyn
# optional read replica
DATABASE_READONLY_URL=postgresql://user:pass@replica:5432/recombyn
```

5. Restart API; startup verifies `SELECT 1 FROM users`.
6. Smoke: login, design run, wallet redeem/spend.

## SQLite → Postgres

Prefer **SQLite → MySQL (dev compose) → Postgres**, or use pgloader from SQLite if available.
Local WAL backups under `storage/backups/` can be kept as freeze points before cutover.

## Read / write split

Runtime data access uses SQLModel (`Session` + `app.crud`). Legacy `connect()` remains only inside DDL (`init_schema` / design table boot). For replica / SQLite read-only / immediate writers when needed:

```python
from app.services.db import connect

with connect(readonly=True) as conn:   # replica or SQLite mode=ro
    ...
with connect(immediate=True) as conn:  # wallet / critical writes (DDL / rare)
    ...
```

Prefer:

```python
from sqlmodel import Session
from app import crud
from app.core.db import engine

with Session(engine) as session:
    ...
```

## Backups

- SQLite: online `Connection.backup` every `DB_BACKUP_INTERVAL_HOURS` (default 24h) → `DB_BACKUP_DIR`
- MySQL/Postgres: scheduler writes a `.hint.txt` with `mysqldump` / `pg_dump`; prefer cloud automated backups in production
- Celery beat task: `worker.tasks.run_db_backup_job`

## LangGraph checkpointer (Design Agent / create_agent)

App data (`DATABASE_URL`) and LangGraph **short-term checkpoints** share the same priority chain in `app/services/llm/agent.py` → `get_agent_checkpointer()`:

| Priority | Backend | When |
|----------|---------|------|
| 1 | MySQL via `langgraph-checkpoint-mysql` | `DATABASE_URL` / `LANGGRAPH_CHECKPOINT_URL` is MySQL **≥ 8.0.19** (or MariaDB ≥ 10.7.1) |
| 2 | SQLite file | Below that version, or MySQL connect/setup fails → `LANGGRAPH_CHECKPOINT_SQLITE_PATH` (default `storage/langgraph_checkpoints.db`) |
| 3 | In-memory | SQLite unavailable |

Password in `DATABASE_URL` must be URL-encoded (`!` → `%21`, `&` → `%26`); the app unquotes before connecting. Sync savers are wrapped so `graph.astream` can call `aget_*` / `aput_*`.

| Env | Role |
|-----|------|
| `LANGGRAPH_CHECKPOINT_URL` | Optional override (empty → reuse `DATABASE_URL`) |
| `LANGGRAPH_CHECKPOINT_SQLITE_PATH` | SQLite fallback path |
| `DESIGN_GRAPH_CHECKPOINT` | Compile outer design graph with checkpointer (default on) |

## Not in scope yet

- Full dual DDL for every `CREATE TABLE` in Postgres (use migration tools)
- LangGraph checkpointer/store **Postgres** backends (still MySQL 8+ / SQLite paths)
