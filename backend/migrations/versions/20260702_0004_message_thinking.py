"""message thinking — persist the assistant's extended-thinking trace

Revision ID: 20260702_0004
Revises: 20260702_0003
Create Date: 2026-07-02 00:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260702_0004"
down_revision = "20260702_0003"
branch_labels = None
depends_on = None


SCHEMA = "vlm"


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("thinking_md", sa.Text(), nullable=False, server_default=""),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("messages", "thinking_md", schema=SCHEMA)
