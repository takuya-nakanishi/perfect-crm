"""Microsoft でログイン(03 §5・02 §8)。結んだ Microsoft アカウントの ID とアドレス、2 段目を待つ札の 1 段目

Microsoft で入るときも 2 段目(TOTP)を通るので、札に「1 段目に何を使ったか」を持たせる(セッションの method になる)。

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("microsoft_sub", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("microsoft_email", sa.Text(), nullable=True))
    op.create_unique_constraint("users_microsoft_sub_key", "users", ["microsoft_sub"])
    op.add_column(
        "login_challenges", sa.Column("method", sa.Text(), server_default=sa.text("'password'"), nullable=False)
    )


def downgrade() -> None:
    op.drop_column("login_challenges", "method")
    op.drop_constraint("users_microsoft_sub_key", "users", type_="unique")
    op.drop_column("users", "microsoft_email")
    op.drop_column("users", "microsoft_sub")
