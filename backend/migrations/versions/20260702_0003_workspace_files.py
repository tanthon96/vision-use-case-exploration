"""workspace files — generic downloadable files (e.g. model-generated CSVs)

Revision ID: 20260702_0003
Revises: 20260701_0002
Create Date: 2026-07-02 00:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PgUUID


revision = "20260702_0003"
down_revision = "20260701_0002"
branch_labels = None
depends_on = None


SCHEMA = "vlm"


def upgrade() -> None:
    op.create_table(
        "files",
        sa.Column("id", PgUUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", PgUUID(as_uuid=True),
                  sa.ForeignKey(f"{SCHEMA}.workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("mime_type", sa.String(64), nullable=False, server_default="text/csv"),
        sa.Column("size_bytes", sa.Integer, nullable=False, server_default="0"),
        sa.Column("object_key", sa.String(512), nullable=False),
        sa.Column("source", sa.String(16), nullable=False, server_default="model"),
        sa.Column("created_by_message_id", PgUUID(as_uuid=True),
                  sa.ForeignKey(f"{SCHEMA}.messages.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        schema=SCHEMA,
    )
    op.create_index("ix_files_workspace", "files", ["workspace_id"], schema=SCHEMA)


def downgrade() -> None:
    op.drop_index("ix_files_workspace", table_name="files", schema=SCHEMA)
    op.drop_table("files", schema=SCHEMA)
