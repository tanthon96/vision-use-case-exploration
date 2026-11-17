from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import String, Integer, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, uuid_pk, created_at_col


class WorkspaceFile(Base):
    """A generic, downloadable workspace file (e.g. a CSV a model produced).

    Distinct from `images`, which are content-addressed and rendered on the
    canvas. Files store arbitrary bytes in S3 and are listed in the Files
    section for download."""

    __tablename__ = "files"

    id: Mapped[UUID] = uuid_pk()
    workspace_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(f"{Base.metadata.schema}.workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(64), default="text/csv")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    object_key: Mapped[str] = mapped_column(String(512), nullable=False)
    # How the file came to exist: 'model' (auto-saved from a run) or 'upload'.
    source: Mapped[str] = mapped_column(String(16), default="model")
    # The assistant message this file was extracted from, if any.
    created_by_message_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(f"{Base.metadata.schema}.messages.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = created_at_col()

    __table_args__ = (
        Index("ix_files_workspace", "workspace_id"),
    )
