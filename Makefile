PROJECT_ID ?= $(shell gcloud config get-value project 2>/dev/null)
REGION     ?= us-central1
IMAGE      := $(REGION)-docker.pkg.dev/$(PROJECT_ID)/vlm-benchmark/app:latest
ADMIN_EMAIL    ?= admin@local
ADMIN_PASSWORD ?= admin

.PHONY: dev down build push deploy migrate seed-admin type-check backend frontend

## Start full local stack (Postgres + MinIO + backend + frontend, hot reload)
dev:
	docker compose up

## Stop everything (preserves volumes — use `make down-clean` to drop them)
down:
	docker compose down

## Stop and wipe volumes (Postgres + MinIO data lost)
down-clean:
	docker compose down -v

## Type-check the frontend
type-check:
	cd frontend && npx tsc --noEmit

## Build the production Docker image (multi-stage)
build:
	docker build -t $(IMAGE) .

## Push to Artifact Registry
push: build
	docker push $(IMAGE)

## Deploy to Cloud Run — assumes Cloud SQL + GCS already exist (see DEPLOY.md)
deploy: push
	gcloud run deploy vlm-benchmark \
		--image $(IMAGE) \
		--region $(REGION) \
		--port 8080 \
		--memory 2Gi \
		--cpu 2 \
		--min-instances 0 \
		--max-instances 3 \
		--no-allow-unauthenticated

## Run Alembic migrations against whatever DATABASE_URL points at
migrate:
	cd backend && uv run alembic upgrade head

## Generate a new Alembic migration. Example: make migration MSG="add foo column"
migration:
	cd backend && uv run alembic revision --autogenerate -m "$(MSG)"

## Print a curl invocation to bootstrap the admin user against a running instance
seed-admin:
	@echo "Login as admin to: http://localhost:8080"
	@echo "Email:    $(ADMIN_EMAIL)"
	@echo "Password: $(ADMIN_PASSWORD)"
	@echo "(set ADMIN_EMAIL / ADMIN_PASSWORD env vars before `make dev` to use different creds)"

## Run backend only (no Docker — requires local postgres + minio)
backend:
	cd backend && uv run uvicorn backend.main:app --reload --port 8080

## Run frontend dev server only
frontend:
	cd frontend && npm run dev

## Open the MinIO console (default creds minioadmin/minioadmin)
minio-console:
	open http://localhost:9001
