"""削除したレコードを指していた参照の控え(02 §4)

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "detached_refs",
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("record_id", sa.UUID(), nullable=False),
        sa.Column("ref_object_key", sa.Text(), nullable=False),
        sa.Column("ref_record_id", sa.UUID(), nullable=False),
        sa.Column("ref_column", sa.Text(), nullable=False),
        sa.Column("ref_object_column", sa.Text(), nullable=True),
        sa.Column(
            "at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("object_key", "record_id", "ref_object_key", "ref_record_id", "ref_column"),
    )


def downgrade() -> None:
    op.drop_table("detached_refs")
