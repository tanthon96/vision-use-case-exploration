from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import String, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, uuid_pk, created_at_col


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), default="")
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = created_at_col()
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        UniqueConstraint("email", name="uq_users_email"),
    )


class Invite(Base):
    __tablename__ = "invites"

    id: Mapped[UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    # Random URL-safe token; the user clicks /accept-invite?token=…
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    invited_by_user_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(f"{Base.metadata.schema}.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at_col()


class Session(Base):
    """Server-side opaque session record. The cookie carries the session id
    signed with itsdangerous; we look it up here on every request."""

    __tablename__ = "sessions"

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(f"{Base.metadata.schema}.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    user_agent: Mapped[str] = mapped_column(String(512), default="")
    created_at: Mapped[datetime] = created_at_col()
