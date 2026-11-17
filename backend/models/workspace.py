from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import String, Text, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, uuid_pk, created_at_col, updated_at_col


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[UUID] = uuid_pk()
    owner_user_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(f"{Base.metadata.schema}.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    __table_args__ = (
        Index("ix_workspaces_owner", "owner_user_id"),
    )
