"""システム表の定義(SQLAlchemy Core)。

業務のテーブル(取引先・商談・タスク…)はここに**書かない**。
初めからある 5 つも、画面から足したものも、`meta_objects` / `meta_fields` を正としてアプリが DDL を流す(02 §4)。
Alembic が面倒を見るのはこのファイルの表だけ。
"""

from sqlalchemy import (
    Boolean,
    Column,
    ForeignKey,
    Integer,
    MetaData,
    PrimaryKeyConstraint,
    Table,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID

metadata = MetaData()

NOW = text("now()")
UUIDV7 = text("uuidv7()")  # PostgreSQL 18 から。時系列順に並ぶ ID(02 §4)


def _ts(name: str, *, nullable: bool = False, default: bool = True) -> Column:
    return Column(name, TIMESTAMP(timezone=True), nullable=nullable, server_default=NOW if default else None)


workspace = Table(
    "workspace",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, server_default=UUIDV7),
    Column("name", Text, nullable=False),
    # 「今日」の基準(IANA)。フィルタのマクロと日時→日付の変換はこの時刻帯で(04 §3)
    Column("timezone", Text, nullable=False, server_default=text("'Asia/Tokyo'")),
    _ts("created_at"),
    _ts("updated_at"),
)

users = Table(
    "users",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, server_default=UUIDV7),
    Column("name", Text, nullable=False),
    Column("email", Text, nullable=False, unique=True),
    Column("avatar_color", Text, nullable=False, server_default=text("'blue'")),
    # 環境設定(テーブル定義・Web フォーム・MCP)を触れる印。ロールは持たない(J-038)
    Column("admin", Boolean, nullable=False, server_default=text("false")),
    # J-023 で本物のログインにするまで NULL
    Column("password_hash", Text, nullable=True),
    Column("deleted_at", TIMESTAMP(timezone=True), nullable=True),
    _ts("created_at"),
    _ts("updated_at"),
)

meta_objects = Table(
    "meta_objects",
    metadata,
    Column("key", Text, primary_key=True),
    Column("label", Text, nullable=False),
    Column("icon", Text, nullable=False),
    Column("color", Text, nullable=False),
    Column("name_field", Text, nullable=False),
    Column("subtitle_field", Text, nullable=True),
    Column("position", Integer, nullable=False),
    Column("in_sidebar", Boolean, nullable=False, server_default=text("true")),
    # 初めから入っているテーブル。画面から削除できない
    Column("system", Boolean, nullable=False, server_default=text("false")),
    Column("completion", JSONB, nullable=True),
    Column("timeline", JSONB, nullable=True),
    # 論理削除(レコードとビューは残る。restore で戻る)
    Column("deleted_at", TIMESTAMP(timezone=True), nullable=True),
    _ts("created_at"),
    _ts("updated_at"),
)

meta_fields = Table(
    "meta_fields",
    metadata,
    Column("object_key", Text, ForeignKey("meta_objects.key", ondelete="CASCADE"), nullable=False),
    Column("key", Text, nullable=False),
    Column("label", Text, nullable=False),
    Column("type", Text, nullable=False),
    Column("position", Integer, nullable=False),
    Column("required", Boolean, nullable=False, server_default=text("false")),
    Column("readonly", Boolean, nullable=False, server_default=text("false")),
    Column("options", JSONB, nullable=True),
    Column("target", Text, nullable=True),
    Column("targets", JSONB, nullable=True),
    Column("columns", JSONB, nullable=True),
    Column("semantic", Text, nullable=True),
    Column("in_create_form", Boolean, nullable=True),
    Column("placeholder", Text, nullable=True),
    Column("max_length", Integer, nullable=True),
    Column("scale", Integer, nullable=True),
    # 業務ルールが使う列。テーブル設定から外せず、型も変えられない
    Column("locked", Boolean, nullable=False, server_default=text("false")),
    Column("all_targets", Boolean, nullable=False, server_default=text("false")),
    # 画面から外した項目。**定義は捨てない**(列の値も残る)。同じ列名で戻せば元の型で復活する(02 §5)
    Column("hidden", Boolean, nullable=False, server_default=text("false")),
    _ts("created_at"),
    _ts("updated_at"),
    PrimaryKeyConstraint("object_key", "key"),
)

meta_views = Table(
    "meta_views",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, server_default=UUIDV7),
    Column("object_key", Text, ForeignKey("meta_objects.key", ondelete="CASCADE"), nullable=False),
    Column("name", Text, nullable=False),
    Column("type", Text, nullable=False),
    Column("position", Integer, nullable=False),
    Column("config", JSONB, nullable=False),
    # サイドバーの「お気に入り」に出す設定(label・position・show_count)
    Column("pin", JSONB, nullable=True),
    Column("deleted_at", TIMESTAMP(timezone=True), nullable=True),
    _ts("created_at"),
    _ts("updated_at"),
)

# アプリが流した DDL の履歴(Alembic と二重管理になる分を追えるように。02 §4)
ddl_log = Table(
    "ddl_log",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, server_default=UUIDV7),
    Column("object_key", Text, nullable=True),
    Column("statement", Text, nullable=False),
    Column("user_id", UUID(as_uuid=True), nullable=True),
    _ts("at"),
)

# 活動の `@` の言及(正は活動の body。ここは検索のための導出値で、捨てて再計算できる。02 §3)
# activities は動的に作られるテーブルなので FK は張らない。掃除はアプリが行う
activity_mentions = Table(
    "activity_mentions",
    metadata,
    Column("activity_id", UUID(as_uuid=True), nullable=False),
    Column("object_key", Text, nullable=False),
    Column("record_id", UUID(as_uuid=True), nullable=False),
    PrimaryKeyConstraint("activity_id", "object_key", "record_id"),
)

# 業務テーブルが必ず持つ列(DDL 経路が足す)。名前はメタデータの項目に使えない(02 §5 の予約)
SYSTEM_COLUMNS = ("id", "created_at", "updated_at", "deleted_at", "search_text")

SYSTEM_TABLES = frozenset(
    {
        "workspace",
        "users",
        "meta_objects",
        "meta_fields",
        "meta_views",
        "ddl_log",
        "activity_mentions",
        "alembic_version",
    }
)
