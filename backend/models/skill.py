from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import String, Text, ForeignKey, UniqueConstraint, Index, DateTime
from sqlalchemy.dialects.postgresql import UUID as PgUUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, uuid_pk, created_at_col, updated_at_col


class Skill(Base):
    """Workspace-scoped, mutable skill. Bundled YAML skills are seeded into
    this table when a workspace is created — there is no separate 'built-in'
    flag because users may edit them freely within their own workspace."""

    __tablename__ = "skills"

    id: Mapped[UUID] = uuid_pk()
    workspace_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(f"{Base.metadata.schema}.workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    task_template: Mapped[str] = mapped_column(Text, default="{{ user_instruction }}")
    metrics_json: Mapped[list] = mapped_column(JSONB, default=list)
    few_shot_examples_json: Mapped[list] = mapped_column(JSONB, default=list)
    # Bundled reference docs [{name, content}] composed into the prompt at run time.
    references_json: Mapped[list] = mapped_column(JSONB, default=list)
    # Optional post-processing script {script_name, script_source} run on the
    # model output after generation (gated by settings.skill_scripts_enabled).
    postprocess_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        # Unique skill name within a workspace, ignoring soft-deletes via a
        # partial index — Alembic handles this via raw SQL in the migration.
        UniqueConstraint("workspace_id", "name", name="uq_skills_workspace_name"),
        Index("ix_skills_workspace", "workspace_id"),
    )


class SkillSnapshot(Base):
    """Immutable copy of a skill at the time a message used it.

    Lets you re-render or compare an old response with the exact prompt
    configuration that produced it, even if the live skill has since changed.
    """

    __tablename__ = "skill_snapshots"

    id: Mapped[UUID] = uuid_pk()
    workspace_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(f"{Base.metadata.schema}.workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Source skill — may be NULL if the skill was later hard-deleted
    skill_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(f"{Base.metadata.schema}.skills.id", ondelete="SET NULL"),
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    task_template: Mapped[str] = mapped_column(Text, default="")
    few_shot_examples_json: Mapped[list] = mapped_column(JSONB, default=list)
    references_json: Mapped[list] = mapped_column(JSONB, default=list)
    postprocess_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    snapshotted_at: Mapped[datetime] = created_at_col()
