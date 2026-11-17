"""initial schema — users, workspaces, images, skills, chats, messages

Revision ID: 20260530_0001
Revises:
Create Date: 2026-05-30 00:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PgUUID, JSONB


revision = "20260530_0001"
down_revision = None
branch_labels = None
depends_on = None


SCHEMA = "vlm"


def upgrade() -> None:
    op.execute(f'CREATE SCHEMA IF NOT EXISTS "{SCHEMA}"')

    # ── users ────────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", PgUUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("is_admin", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("last_login_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("email", name="uq_users_email"),
        schema=SCHEMA,
    )

    # ── invites ──────────────────────────────────────────────────────────────
    op.create_table(
        "invites",
        sa.Column("id", PgUUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("invited_by_user_id", PgUUID(as_uuid=True),
                  sa.ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        schema=SCHEMA,
    )
    op.create_index("ix_invites_token", "invites", ["token"], schema=SCHEMA, unique=True)

    # ── sessions ─────────────────────────────────────────────────────────────
    op.create_table(
        "sessions",
        sa.Column("id", PgUUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", PgUUID(as_uuid=True),
                  sa.ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("user_agent", sa.String(512), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        schema=SCHEMA,
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"], schema=SCHEMA)

    # ── workspaces ───────────────────────────────────────────────────────────
    op.create_table(
        "workspaces",
        sa.Column("id", PgUUID(as_uuid=True), primary_key=True),
        sa.Column("owner_user_id", PgUUID(as_uuid=True),
                  sa.ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        schema=SCHEMA,
    )
    op.create_index("ix_workspaces_owner", "workspaces", ["owner_user_id"], schema=SCHEMA)

    # ── images ───────────────────────────────────────────────────────────────
    op.create_table(
        "images",
        sa.Column("id", PgUUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", PgUUID(as_uuid=True),
                  sa.ForeignKey(f"{SCHEMA}.workspaces.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("object_key", sa.String(512), nullable=False),
        sa.Column("original_name", sa.String(256), nullable=False, server_default=""),
        sa.Column("mime_type", sa.String(64), nullable=False, server_default="image/jpeg"),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("width", sa.Integer),
        sa.Column("height", sa.Integer),
        sa.Column("size_bytes", sa.Integer, nullable=False, server_default="0"),
        sa.Column("source", sa.String(16), nullable=False, server_default="upload"),
        sa.Column("created_by_user_id", PgUUID(as_uuid=True),
                  sa.ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("workspace_id", "sha256", name="uq_images_workspace_sha256"),
        schema=SCHEMA,
    )
    op.create_index("ix_images_workspace", "images", ["workspace_id"], schema=SCHEMA)

    # ── skills ───────────────────────────────────────────────────────────────
    op.create_table(
        "skills",
        sa.Column("id", PgUUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", PgUUID(as_uuid=True),
                  sa.ForeignKey(f"{SCHEMA}.workspaces.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("system_prompt", sa.Text, nullable=False, server_default=""),
        sa.Column("task_template", sa.Text, nullable=False,
                  server_default="{{ user_instruction }}"),
        sa.Column("metrics_json", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("few_shot_examples_json", JSONB, nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("workspace_id", "name", name="uq_skills_workspace_name"),
        schema=SCHEMA,
    )
    op.create_index("ix_skills_workspace", "skills", ["workspace_id"], schema=SCHEMA)

    # ── skill_snapshots ──────────────────────────────────────────────────────
    op.create_table(
        "skill_snapshots",
        sa.Column("id", PgUUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", PgUUID(as_uuid=True),
                  sa.ForeignKey(f"{SCHEMA}.workspaces.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("skill_id", PgUUID(as_uuid=True),
                  sa.ForeignKey(f"{SCHEMA}.skills.id", ondelete="SET NULL")),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("system_prompt", sa.Text, nullable=False, server_default=""),
        sa.Column("task_template", sa.Text, nullable=False, server_default=""),
        sa.Column("few_shot_examples_json", JSONB, nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column("snapshotted_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        schema=SCHEMA,
    )

    # ── chats ────────────────────────────────────────────────────────────────
    op.create_table(
        "chats",
        sa.Column("id", PgUUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", PgUUID(as_uuid=True),
                  sa.ForeignKey(f"{SCHEMA}.workspaces.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("title", sa.String(200), nullable=False, server_default=""),
        sa.Column("created_by_user_id", PgUUID(as_uuid=True),
                  sa.ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL")),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_chats_workspace_updated", "chats",
        ["workspace_id", "updated_at"], schema=SCHEMA,
    )

    # ── messages ─────────────────────────────────────────────────────────────
    op.create_table(
        "messages",
        sa.Column("id", PgUUID(as_uuid=True), primary_key=True),
        sa.Column("chat_id", PgUUID(as_uuid=True),
                  sa.ForeignKey(f"{SCHEMA}.chats.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("sequence_no", sa.Integer, nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content_md", sa.Text, nullable=False, server_default=""),
        sa.Column("model_provider", sa.String(64)),
        sa.Column("model_id", sa.String(128)),
        sa.Column("skill_snapshot_id", PgUUID(as_uuid=True),
                  sa.ForeignKey(f"{SCHEMA}.skill_snapshots.id", ondelete="SET NULL")),
        sa.Column("latency_ms", sa.Float),
        sa.Column("prompt_tokens", sa.Integer, nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer, nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Float, nullable=False, server_default="0"),
        sa.Column("error", sa.Text, nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("chat_id", "sequence_no", name="uq_messages_chat_sequence"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_messages_chat_sequence", "messages",
        ["chat_id", "sequence_no"], schema=SCHEMA,
    )
    op.create_index(
        "ix_messages_model_created", "messages",
        ["model_provider", "model_id", "created_at"], schema=SCHEMA,
    )

    # ── message_images ───────────────────────────────────────────────────────
    op.create_table(
        "message_images",
        sa.Column("message_id", PgUUID(as_uuid=True),
                  sa.ForeignKey(f"{SCHEMA}.messages.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("image_id", PgUUID(as_uuid=True),
                  sa.ForeignKey(f"{SCHEMA}.images.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("annotations_json", JSONB, nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_message_images_image", "message_images",
        ["image_id"], schema=SCHEMA,
    )


def downgrade() -> None:
    for table in (
        "message_images", "messages", "chats",
        "skill_snapshots", "skills",
        "images", "workspaces",
        "sessions", "invites", "users",
    ):
        op.drop_table(table, schema=SCHEMA)
    op.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE')
