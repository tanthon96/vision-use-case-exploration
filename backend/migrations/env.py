"""Alembic env. Uses the same async engine as the app."""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.engine import Connection

# We rely on the package being importable as `backend.*`
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.core.config import settings        # noqa: E402
from backend.core.database import engine        # noqa: E402
from backend.models import Base                 # noqa: E402

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Tell Alembic about our metadata so `--autogenerate` works.
target_metadata = Base.metadata

# Inject the runtime DATABASE_URL into Alembic.
config.set_main_option("sqlalchemy.url", settings.database_url)


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_schemas=True,
        version_table_schema=Base.metadata.schema,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    # Ensure the target schema exists before Alembic touches its version table.
    connection.exec_driver_sql(
        f'CREATE SCHEMA IF NOT EXISTS "{Base.metadata.schema}"'
    )
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_schemas=True,
        version_table_schema=Base.metadata.schema,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
