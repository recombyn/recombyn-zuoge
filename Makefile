.PHONY: dev dev-web dev-api dev-redis dev-worker dev-stack build install install-api health

dev-web:
	npm run dev:web

dev-api:
	cd apps/api && python -m uvicorn main:app --reload --port 8000

dev-redis:
	docker compose up -d redis

dev-worker:
	cd apps/api && celery -A worker.celery_app.celery worker -l info --pool=solo

dev-stack:
	docker compose up -d redis api worker

dev:
	@echo "Run make dev-redis, then make dev-api and make dev-worker (or make dev-stack)"

health:
	curl -s http://localhost:8000/api/v1/health

build:
	npm run build

install:
	npm install

install-api:
	cd apps/api && pip install -e ../../packages/scene-builder-py && pip install -e .
