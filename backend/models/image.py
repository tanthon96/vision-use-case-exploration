from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import String, Integer, ForeignKey, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, uuid_pk, created_at_col


class Image(Base):
    __tablename__ = "images"

    id: Mapped[UUID] = uuid_pk()
    workspace_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(f"{Base.metadata.schema}.workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Where the bytes actually live in S3 (object key, not URL)
    object_key: Mapped[str] = mapped_column(String(512), nullable=False)
    original_name: Mapped[str] = mapped_column(String(256), default="")
    mime_type: Mapped[str] = mapped_column(String(64), default="image/jpeg")
    # Content hash — used for dedupe and for content-addressed S3 keys
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    # Where the user obtained this image
    source: Mapped[str] = mapped_column(String(16), default="upload")  # 'upload'|'webcam'|'screen'
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(f"{Base.metadata.schema}.users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = created_at_col()

    __table_args__ = (
        # Same content can only be stored once per workspace.
        UniqueConstraint("workspace_id", "sha256", name="uq_images_workspace_sha256"),
        Index("ix_images_workspace", "workspace_id"),
    )
