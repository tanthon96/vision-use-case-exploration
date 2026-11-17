"""FastAPI app entry point.

Boot sequence:
  1. Run Alembic migrations to head (idempotent).
  2. Ensure the S3 bucket exists.
  3. (Phase B) seed the admin user if the users table is empty and ADMIN_*
     env vars are set.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .core.auth import seed_admin_if_empty
from .core.config import settings
from .core.database import SessionLocal
from .core.storage import ensure_bucket
from .seed.skills import backfill_all_workspaces
from .api.routers import auth, benchmark, chats, comparisons, files, images, models, skills, workspaces


log = logging.getLogger("vlm")
logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))


def _run_migrations() -> None:
    """Apply all pending Alembic migrations."""
    cfg = AlembicConfig(str(Path(__file__).parent / "alembic.ini"))
    cfg.set_main_option("script_location", str(Path(__file__).parent / "migrations"))
    command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Running database migrations...")
    # Alembic's env.py uses asyncio.run() which can't nest inside an existing
    # event loop, so run the whole sync command.upgrade() in a worker thread.
    await asyncio.to_thread(_run_migrations)
    log.info("Ensuring S3 bucket exists...")
    try:
        await ensure_bucket()
    except Exception as e:
        log.warning("Could not ensure S3 bucket (%s) — image uploads will fail", e)
    log.info("Seeding admin if users table is empty...")
    async with SessionLocal() as db:
        await seed_admin_if_empty(db)
    log.info("Backfilling bundled skills into existing workspaces...")
    async with SessionLocal() as db:
        inserted = await backfill_all_workspaces(db)
    if inserted:
        log.info("Backfilled %d bundled skill(s) across workspaces.", inserted)
    log.info("App ready.")
    yield


app = FastAPI(title="VLM Benchmark", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router)
app.include_router(models.router)
app.include_router(workspaces.router)
app.include_router(images.router)
app.include_router(files.router)
app.include_router(skills.router)
app.include_router(chats.router)
app.include_router(benchmark.router)
app.include_router(comparisons.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": app.version}


# Serve the built React SPA in production. In dev, Vite handles this.
_STATIC = Path(__file__).parent.parent / "frontend" / "dist"
if _STATIC.exists():
    app.mount("/assets", StaticFiles(directory=_STATIC / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        return FileResponse(_STATIC / "index.html")
