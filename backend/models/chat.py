from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    String, Text, Integer, Float, ForeignKey, DateTime,
    UniqueConstraint, Index,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, uuid_pk, created_at_col, updated_at_col


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[UUID] = uuid_pk()
    workspace_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(f"{Base.metadata.schema}.workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(200), default="")
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(f"{Base.metadata.schema}.users.id", ondelete="SET NULL"),
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    __table_args__ = (
        Index("ix_chats_workspace_updated", "workspace_id", "updated_at"),
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[UUID] = uuid_pk()
    chat_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(f"{Base.metadata.schema}.chats.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Monotonic position within the chat (1, 2, 3, …). Set on insert via
    # SELECT COALESCE(MAX(sequence_no), 0) + 1.
    sequence_no: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # 'user' | 'assistant' | 'system'
    content_md: Mapped[str] = mapped_column(Text, default="")
    # Assistant reasoning trace (extended thinking), when the model emitted one.
    # Rendered in a collapsible dropdown; empty for models/turns without thinking.
    thinking_md: Mapped[str] = mapped_column(Text, default="")
    # Effort level applied for this run (low/medium/high/max), or "off". Empty
    # for models without thinking. Lets runs be compared by reasoning depth.
    thinking_effort: Mapped[str] = mapped_column(String(16), default="")

    # Assistant-only metadata. NULL for user/system messages.
    model_provider: Mapped[str | None] = mapped_column(String(64))
    model_id: Mapped[str | None] = mapped_column(String(128))
    skill_snapshot_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(f"{Base.metadata.schema}.skill_snapshots.id", ondelete="SET NULL"),
    )
    latency_ms: Mapped[float | None] = mapped_column(Float)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    error: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = created_at_col()

    __table_args__ = (
        UniqueConstraint("chat_id", "sequence_no", name="uq_messages_chat_sequence"),
        Index("ix_messages_chat_sequence", "chat_id", "sequence_no"),
        Index("ix_messages_model_created", "model_provider", "model_id", "created_at"),
    )


class MessageImage(Base):
    """N:N join between messages and images.

    Annotations are stored here (not on the Image) because the same image
    can be highlighted differently in different chats. JSON blob mirrors the
    frontend's Annotation type.
    """

    __tablename__ = "message_images"

    message_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(f"{Base.metadata.schema}.messages.id", ondelete="CASCADE"),
        primary_key=True,
    )
    image_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(f"{Base.metadata.schema}.images.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # Preserves the order images appeared in the user turn.
    position: Mapped[int] = mapped_column(Integer, default=0)
    annotations_json: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = created_at_col()

    __table_args__ = (
        Index("ix_message_images_image", "image_id"),
    )
