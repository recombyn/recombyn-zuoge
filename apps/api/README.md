# zuoge API

FastAPI：画布 Scene、项目与广场、Design Agent、钱包、Admin。本地文档：http://127.0.0.1:8000/docs

更多：[Self-hosting](../../docs/self-hosting.md) · [Billing](../../docs/billing.md) · [AgentProfile](../../docs/agent-profile.md) · [用户文档](https://recombyn.github.io/recombyn/)

## 本地

```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate   # Unix: source .venv/bin/activate
pip install -e ../../packages/scene-builder-py
pip install -e ../../packages/protocol
pip install -e ../../packages/intelligence-client
pip install -e ".[dev]"
# MySQL + Redis: 仓库根 docker compose up -d mysql redis（或 npm run dev:infra）
# apps/api/.env 必须设置 DATABASE_URL=mysql://recombyn:recombyn@127.0.0.1:3306/recombyn
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
# 或仓库根: npm run dev:api
```

Worker：`celery -A worker.celery_app.celery worker -l info`（Windows 加 `--pool=solo`）。

环境变量：复制 `.env.example`（需配置 MySQL 或 Postgres 的 `DATABASE_URL`）。种子：`seeds/`（提示词包以 git 为准；Admin 改过的 Skill 等以 DB 为准）。测试：`npm run test:api`（仓库根；连 `recombyn_test` MySQL 库）。

## 认证

| 方式 | 环境变量 |
|------|----------|
| 邮件验证码 | 腾讯云 SES：`TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`、`SES_*`（无控制台回退） |
| Google | `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` |

`GET /api/v1/auth/config` — 公开：`googleEnabled`、`emailEnabled`、`billingEnabled`。

## 积分 / 钱包

| 变量 | 默认 | 说明 |
|------|------|------|
| `WALLET_BILLING_ENABLED` | `true` | 预扣与结算；默认开启 |
| `CARD_KEY_SALT` / `CARD_KEY_OPS_PASSWORD` | — | 卡密兑换（billing 开启时） |

设为 `false` 时跳过 hold/charge；前端通过 `auth/config.billingEnabled` 隐藏积分 UI。
