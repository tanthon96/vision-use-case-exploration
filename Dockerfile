# ── Stage 1: build React frontend ──────────────────────────────────────────────
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --prefer-offline

COPY frontend/ .
RUN npm run build

# ── Stage 2: Python backend ─────────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# System deps for Pillow + uv
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

# Install dependencies from lockfile (fast, reproducible)
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Put the venv on PATH so uvicorn etc. are found without `uv run`
ENV PATH="/app/.venv/bin:$PATH"

# Copy application code
COPY backend/ ./backend/
# Bundle the seed skills under /app/skills (workspaces seed from here)
COPY backend/skills/ ./skills/

# Copy compiled frontend
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Defaults — override at runtime
ENV SKILLS_DIR=/app/skills

EXPOSE 8080

# Alembic auto-runs from backend/main.py's lifespan, so we just start uvicorn.
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
