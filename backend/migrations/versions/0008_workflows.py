"""ワークフローと実行記録。Slack のチャンネルを複数に(04 §14・§15)

これまでの「Web フォームから登録があったら、繋いだ Slack のチャンネルへ知らせる」は、同じ動きのワークフローに置き換える
(`carry_over_form_notice`)。置き換えたあとは、Web フォームの受け口は自分では知らせない。

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-30
"""

import json
import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _ts(name: str) -> sa.Column:
    return sa.Column(
        name, postgresql.TIMESTAMP(timezone=True), server_default=sa.text("clock_timestamp()"), nullable=False
    )


def upgrade() -> None:
    op.create_unique_constraint("slack_connections_channel", "slack_connections", ["team_id", "channel_id"])
    op.create_table(
        "workflows",
        sa.Column("id", sa.UUID(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("trigger", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("actions", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("deleted_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        _ts("created_at"),
        _ts("updated_at"),
        sa.ForeignKeyConstraint(["object_key"], ["meta_objects.key"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "workflow_runs",
        sa.Column("id", sa.UUID(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("workflow_id", sa.UUID(), nullable=False),
        sa.Column("action_id", sa.Text(), nullable=False),
        sa.Column("action_type", sa.Text(), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("record_id", sa.UUID(), nullable=False),
        sa.Column("record_name", sa.Text(), nullable=False),
        sa.Column("event", sa.Text(), nullable=False),
        sa.Column("origin", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.UUID(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("next_attempt_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("locked_until", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("error_code", sa.Text(), nullable=True),
        _ts("created_at"),
        _ts("updated_at"),
        sa.Column("finished_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("workflow_runs_due", "workflow_runs", ["status", "next_attempt_at"])
    op.create_index("workflow_runs_by_workflow", "workflow_runs", ["workflow_id", "created_at"])
    carry_over_form_notice(op.get_bind())


def carry_over_form_notice(bind: sa.Connection) -> int:
    """これまでの Web フォームの通知を、同じ動きのワークフローにする。作った数を返す。

    Slack と繋いでいなければ、これまでも何も送っていないので作らない。テーブルごとに 1 つ
    (Web フォームがあるテーブル)。載せる項目は、そのテーブルのフォームが受け付ける項目を合わせたもの
    (これまでの本文は、そのフォームが受け付けた項目だった)。
    """
    channel = bind.execute(sa.text("select id from slack_connections order by created_at desc limit 1")).first()
    if channel is None:
        return 0
    labels = dict(bind.execute(sa.text("select key, label from meta_objects where deleted_at is null")).all())
    by_object: dict[str, list[str]] = {}
    for object_key, fields in bind.execute(sa.text("select object_key, fields from web_forms order by created_at")):
        if object_key not in labels:
            continue
        keys = by_object.setdefault(object_key, [])
        keys.extend(k for k in fields if k not in keys)
    for object_key, fields in by_object.items():
        name = "Web フォームからの登録"
        if len(by_object) > 1:
            name = f"{name}({labels[object_key]})"
        trigger = {"event": "created", "origins": ["form"]}
        actions = [{"id": str(uuid.uuid4()), "type": "slack", "channel": str(channel.id), "fields": fields}]
        bind.execute(
            sa.text(
                "insert into workflows (name, object_key, trigger, actions)"
                " values (:name, :object_key, cast(:trigger as jsonb), cast(:actions as jsonb))"
            ),
            {
                "name": name,
                "object_key": object_key,
                "trigger": json.dumps(trigger, ensure_ascii=False),
                "actions": json.dumps(actions, ensure_ascii=False),
            },
        )
    return len(by_object)


def downgrade() -> None:
    op.drop_index("workflow_runs_by_workflow", table_name="workflow_runs")
    op.drop_index("workflow_runs_due", table_name="workflow_runs")
    op.drop_table("workflow_runs")
    op.drop_table("workflows")
    op.drop_constraint("slack_connections_channel", "slack_connections", type_="unique")
