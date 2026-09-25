"""サイドバーのフォルダ(02 §2・05 §13)

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _ts(name: str) -> sa.Column:
    return sa.Column(
        name,
        postgresql.TIMESTAMP(timezone=True),
        server_default=sa.text("clock_timestamp()"),
        nullable=False,
    )


def upgrade() -> None:
    op.create_table(
        "meta_folders",
        sa.Column("id", sa.UUID(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        _ts("created_at"),
        _ts("updated_at"),
        sa.PrimaryKeyConstraint("id"),
    )
    # フォルダを消すと、中のテーブルはフォルダの外へ(テーブルは消さない)
    op.add_column("meta_objects", sa.Column("folder_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "meta_objects_folder_id_fkey",
        "meta_objects",
        "meta_folders",
        ["folder_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("meta_objects_folder_id_fkey", "meta_objects", type_="foreignkey")
    op.drop_column("meta_objects", "folder_id")
    op.drop_table("meta_folders")
