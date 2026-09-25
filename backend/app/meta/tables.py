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

# 行ごとの実時刻。now() はトランザクション開始時刻で、1 回の取り込みの全行が同じ値になる
NOW = text("clock_timestamp()")
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

# 削除したレコードを指していた参照の控え(02 §4)。削除のときに指している側の列を空にしてここへ残し、
# 元に戻したら付け直す。業務テーブルは動的に作られるので FK は張らない
detached_refs = Table(
    "detached_refs",
    metadata,
    # 削除したレコード
    Column("object_key", Text, nullable=False),
    Column("record_id", UUID(as_uuid=True), nullable=False),
    # それを指していた行と列。polymorphic は「どのテーブルか」の列(`ref_object_column`)も空にしている
    Column("ref_object_key", Text, nullable=False),
    Column("ref_record_id", UUID(as_uuid=True), nullable=False),
    Column("ref_column", Text, nullable=False),
    Column("ref_object_column", Text, nullable=True),
    _ts("at"),
    PrimaryKeyConstraint("object_key", "record_id", "ref_object_key", "ref_record_id", "ref_column"),
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
        "detached_refs",
        "mcp_tokens",
        "web_forms",
        "google_accounts",
        "oauth_clients",
        "oauth_requests",
        "oauth_grants",
        "oauth_codes",
        "oauth_tokens",
        "alembic_version",
    }
)

# MCP(や将来の API)のアクセストークン。**全文は保存しない**(ハッシュだけ。04 §10)
mcp_tokens = Table(
    "mcp_tokens",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, server_default=UUIDV7),
    Column("name", Text, nullable=False),
    # 繋いだアプリ(claude-desktop / claude-code / codex / other)
    Column("client", Text, nullable=False),
    # 見分けるための先頭 8 文字
    Column("prefix", Text, nullable=False),
    Column("token_hash", Text, nullable=False, unique=True),
    Column("created_by", UUID(as_uuid=True), ForeignKey("users.id"), nullable=True),
    Column("last_used_at", TIMESTAMP(timezone=True), nullable=True),
    _ts("created_at"),
)

# Web フォーム(Salesforce の Web-to-Lead の汎用版)。受け口は認証なし(04 §10)
web_forms = Table(
    "web_forms",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, server_default=UUIDV7),
    Column("name", Text, nullable=False),
    Column("object_key", Text, nullable=False),
    Column("fields", JSONB, nullable=False),
    Column("defaults", JSONB, nullable=False),
    # 受け口の URL に入る秘密。漏れたら rotate で作り直す
    Column("key", Text, nullable=False, unique=True),
    Column("enabled", Boolean, nullable=False, server_default=text("true")),
    Column("redirect_url", Text, nullable=True),
    Column("submissions", Integer, nullable=False, server_default=text("0")),
    Column("last_submitted_at", TIMESTAMP(timezone=True), nullable=True),
    _ts("created_at"),
)

# 利用者ごとに繋いだ Google アカウント(04 §8)。**refresh token は暗号化して持つ**(`app/google/store.py`)。
# 1 利用者 1 アカウント。解除したら行ごと消す
google_accounts = Table(
    "google_accounts",
    metadata,
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    # 繋いだ Google のアドレス(画面に出すだけ。突き合わせには使わない)
    Column("email", Text, nullable=False),
    Column("refresh_token", Text, nullable=False),
    # 使い回しのための控え。切れていれば refresh token で取り直す
    Column("access_token", Text, nullable=True),
    Column("expires_at", TIMESTAMP(timezone=True), nullable=True),
    Column("scope", Text, nullable=False),
    _ts("created_at"),
    _ts("updated_at"),
)


# --- MCP を Claude のカスタムコネクタから使うための OAuth(03 §6・04 §13)------------------------
# Works 自身が認可サーバになる。人の確認は Access の内側の画面で行い、Anthropic からの機械の呼び出し
# (トークンの交換・MCP)はアプリのトークンで守る。**コードもトークンも全文は保存しない**(sha256 だけ)

# 動的登録(RFC 7591)で来たアプリ。`info` は SDK の OAuthClientInformationFull をそのまま
oauth_clients = Table(
    "oauth_clients",
    metadata,
    Column("client_id", Text, primary_key=True),
    Column("info", JSONB, nullable=False),
    _ts("created_at"),
)

# 認可の途中。/authorize で受けた中身を置き、画面(Access の内側)で本人が許可するのを待つ。数分で切れる
oauth_requests = Table(
    "oauth_requests",
    metadata,
    Column("id", Text, primary_key=True),
    Column("client_id", Text, ForeignKey("oauth_clients.client_id", ondelete="CASCADE"), nullable=False),
    Column("params", JSONB, nullable=False),
    Column("expires_at", TIMESTAMP(timezone=True), nullable=False),
    _ts("created_at"),
)

# 許可(= 環境設定に並ぶ「接続中のアプリ」)。消すと、その許可から出たコードとトークンも消える
oauth_grants = Table(
    "oauth_grants",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, server_default=UUIDV7),
    Column("client_id", Text, ForeignKey("oauth_clients.client_id", ondelete="CASCADE"), nullable=False),
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("scopes", JSONB, nullable=False),
    Column("last_used_at", TIMESTAMP(timezone=True), nullable=True),
    _ts("created_at"),
)

oauth_codes = Table(
    "oauth_codes",
    metadata,
    Column("code_hash", Text, primary_key=True),
    Column("grant_id", UUID(as_uuid=True), ForeignKey("oauth_grants.id", ondelete="CASCADE"), nullable=False),
    Column("params", JSONB, nullable=False),
    Column("expires_at", TIMESTAMP(timezone=True), nullable=False),
    _ts("created_at"),
)

# access(短命)と refresh(使うたびに新しいものへ替える)
oauth_tokens = Table(
    "oauth_tokens",
    metadata,
    Column("token_hash", Text, primary_key=True),
    Column("grant_id", UUID(as_uuid=True), ForeignKey("oauth_grants.id", ondelete="CASCADE"), nullable=False),
    Column("kind", Text, nullable=False),
    Column("expires_at", TIMESTAMP(timezone=True), nullable=False),
    _ts("created_at"),
)
