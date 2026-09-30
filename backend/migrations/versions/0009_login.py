"""自前のログイン(03 §5・02 §8)。パスワードと 2 段階認証(TOTP)、ブラウザのセッション、2 段目を待つ札、ログインの試み

Google でログイン(J-054)で使う列(`google_sub`・`google_email`)も、ここで足しておく。

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _ts(name: str, *, nullable: bool = True) -> sa.Column:
    return sa.Column(name, postgresql.TIMESTAMP(timezone=True), nullable=nullable)


def _now(name: str) -> sa.Column:
    return sa.Column(
        name, postgresql.TIMESTAMP(timezone=True), server_default=sa.text("clock_timestamp()"), nullable=False
    )


def upgrade() -> None:
    op.add_column("users", _ts("password_changed_at"))
    op.add_column("users", sa.Column("google_sub", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("google_email", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("totp_secret", sa.Text(), nullable=True))
    op.add_column("users", _ts("totp_enabled_at"))
    op.add_column("users", sa.Column("totp_last_step", sa.BigInteger(), nullable=True))
    op.add_column("users", sa.Column("totp_pending_secret", sa.Text(), nullable=True))
    op.add_column("users", _ts("last_login_at"))
    op.create_unique_constraint("users_google_sub_key", "users", ["google_sub"])

    op.create_table(
        "user_sessions",
        sa.Column("id", sa.UUID(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("method", sa.Text(), nullable=False),
        _ts("expires_at", nullable=False),
        _now("last_seen_at"),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("ip", sa.Text(), nullable=True),
        _now("created_at"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_table(
        "login_challenges",
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        _ts("expires_at", nullable=False),
        _now("created_at"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("token_hash"),
    )
    op.create_table(
        "login_attempts",
        sa.Column("id", sa.UUID(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("method", sa.Text(), nullable=False),
        sa.Column("ip", sa.Text(), nullable=True),
        sa.Column("succeeded", sa.Boolean(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        _now("created_at"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("login_attempts_user", "login_attempts", ["user_id", "created_at"])
    op.create_index("login_attempts_ip", "login_attempts", ["ip", "created_at"])


def downgrade() -> None:
    op.drop_index("login_attempts_ip", table_name="login_attempts")
    op.drop_index("login_attempts_user", table_name="login_attempts")
    op.drop_table("login_attempts")
    op.drop_table("login_challenges")
    op.drop_table("user_sessions")
    op.drop_constraint("users_google_sub_key", "users", type_="unique")
    for column in (
        "last_login_at",
        "totp_pending_secret",
        "totp_last_step",
        "totp_enabled_at",
        "totp_secret",
        "google_email",
        "google_sub",
        "password_changed_at",
    ):
        op.drop_column("users", column)
