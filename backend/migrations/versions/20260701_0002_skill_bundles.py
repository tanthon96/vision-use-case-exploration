"""skill bundles — references + post-processing script columns

Revision ID: 20260701_0002
Revises: 20260530_0001
Create Date: 2026-07-01 00:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "20260701_0002"
down_revision = "20260530_0001"
branch_labels = None
depends_on = None


SCHEMA = "vlm"


def upgrade() -> None:
    for table in ("skills", "skill_snapshots"):
        op.add_column(
            table,
            sa.Column("references_json", JSONB, nullable=False,
                      server_default=sa.text("'[]'::jsonb")),
            schema=SCHEMA,
        )
        op.add_column(
            table,
            sa.Column("postprocess_json", JSONB, nullable=False,
                      server_default=sa.text("'{}'::jsonb")),
            schema=SCHEMA,
        )


def downgrade() -> None:
    for table in ("skills", "skill_snapshots"):
        op.drop_column(table, "postprocess_json", schema=SCHEMA)
        op.drop_column(table, "references_json", schema=SCHEMA)
