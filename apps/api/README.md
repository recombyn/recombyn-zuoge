# Recombyn API

FastAPI：画布 Scene、项目与广场、Design Agent、钱包、Admin。本地文档：http://127.0.0.1:8000/docs

更多：[Self-hosting](../../docs/self-hosting.md) · [AgentProfile](../../docs/agent-profile.md) · [用户文档](https://recombyn.github.io/recombyn/)

## 本地

```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate   # Unix: source .venv/bin/activate
pip install -e ../../packages/scene-builder-py
pip install -e ../../packages/protocol
pip install -e ../../packages/intelligence-client
pip install -e ".[dev]"
# Redis: 仓库根 docker compose up -d redis
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
# 或仓库根: npm run dev:api
```

Worker：`celery -A worker.celery_app.celery worker -l info`（Windows 加 `--pool=solo`）。

环境变量：复制 `.env.example`。种子：`seeds/`（提示词包以 git 为准；Admin 改过的 Skill 等以 DB 为准）。测试：`npm run test:api`（仓库根）。
