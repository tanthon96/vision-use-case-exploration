"""Async SQLAlchemy + asyncpg engine and session factory."""

from __future__ import annotations

from typing import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine, AsyncSession,
    create_async_engine, async_sessionmaker,
)

from .config import settings
from ..models import Base  # noqa: F401 — re-exported for callers


def _build_engine() -> AsyncEngine:
    return create_async_engine(
        settings.database_url,
        echo=False,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
    )


engine: AsyncEngine = _build_engine()
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency. Yields a session; commits and closes automatically.

    On unhandled exceptions the session is rolled back. Routes that need
    explicit transaction boundaries can call `await db.commit()` mid-request.
    """
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
