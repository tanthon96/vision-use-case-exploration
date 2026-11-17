from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import MetaData, DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID as PgUUID


# Single schema for all app tables — keeps things tidy and lets ops keep
# raw postgres extensions / admin tables in `public`.
SCHEMA = "vlm"

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(schema=SCHEMA, naming_convention=NAMING_CONVENTION)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def uuid_pk() -> Mapped[UUID]:
    """Convenience: UUIDv4 primary key column."""
    return mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)


def created_at_col() -> Mapped[datetime]:
    return mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        nullable=False,
    )


def updated_at_col() -> Mapped[datetime]:
    return mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )
