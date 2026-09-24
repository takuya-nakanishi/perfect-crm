"""Works の MCP サーバ(03 §6・04 §13・J-028)。`<公開 URL>/mcp` の Streamable HTTP。

- 繋ぎ方は 2 つ。**Claude のカスタムコネクタ**(OAuth。1 回足せば Web・デスクトップ・スマホ・Claude Code の
  どれでも使える)と、**環境設定で発行したトークン**(`wks_`。Codex など、ヘッダを自分で付けるアプリ)
- ツールは画面と同じ関数(`app/records/service.py` など)を呼ぶ。検証・既定値・業務ルールも画面と同じ経路を通る。
  DB を直に触らせない。書き込みは「誰として」を、トークンの持ち主(利用者)にする
- 削除のツールは持たない(画面の「元に戻す」と違い、会話の中では取り消しに気づきにくいため)
"""

from typing import Any
from urllib.parse import urlparse

from mcp.server import MCPServer
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions, RevocationOptions
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import AnyHttpUrl
from sqlalchemy import Connection
from starlette.applications import Starlette

from app import db
from app.config import get_settings
from app.errors import ApiError
from app.mcpserver.oauth import SCOPE, WorksOAuthProvider, mcp_url
from app.meta import store
from app.records import service
from app.records.search import search as search_records
from app.records.timeline import timeline

MAX_LIMIT = 200

INSTRUCTIONS = """Works は取引先・取引先責任者・商談・タスク・活動を持つ CRM です。
まず list_tables でテーブルと項目(列名・型・選択肢)を確かめてから、読み書きしてください。
値は列名(snake_case)で渡し、選択肢は value(ラベルではない)、参照は相手のレコードの id、日付は YYYY-MM-DD です。
フィルタの値には $today / $today+7 / $today-30 / $start_of_month / $end_of_month / $me が使えます。
タスクを完了にするには update_record で status を done にします。"""


def _me() -> str:
    token = get_access_token()
    if token is None or not token.subject:
        raise ToolError("認証されていません")
    return token.subject


def _call(fn: Any) -> Any:
    """1 回の呼び出し = 1 トランザクション。API の失敗は、AI が読んで直せる文にして返す。"""
    try:
        with db.transaction() as conn:
            return fn(conn)
    except ApiError as exc:
        raise ToolError(f"{exc.message}({exc.code})") from exc


def _field_summary(field: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"key": field["key"], "label": field["label"], "type": field["type"]}
    for name in ("required", "readonly"):
        if field.get(name):
            out[name] = True
    if field.get("options"):
        out["options"] = [{"value": o["value"], "label": o["label"]} for o in field["options"]]
    for name in ("target", "targets", "columns"):
        if field.get(name):
            out[name] = field[name]
    return out


def list_tables() -> list[dict[str, Any]]:
    """テーブル(取引先・商談・タスクなど)と、その項目の一覧。読み書きの前に 1 回呼んで列名と選択肢を確かめる。"""
    _me()

    def fn(conn: Connection) -> list[dict[str, Any]]:
        return [
            {
                "key": o["key"],
                "label": o["label"],
                "name_field": o["name_field"],
                "fields": [_field_summary(f) for f in o["fields"]],
            }
            for o in store.live_objects(conn)
        ]

    result: list[dict[str, Any]] = _call(fn)
    return result


def search(query: str) -> dict[str, Any]:
    """すべてのテーブルを名前などで横断検索する(ひらがな・カタカナ・全角半角の違いは吸収する)。"""
    _me()
    result: dict[str, Any] = _call(lambda conn: search_records(conn, query))
    return result


def list_records(
    table: str,
    filter: dict[str, Any] | None = None,
    sort: list[dict[str, Any]] | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """1 つのテーブルのレコードを条件で探す。

    filter は {"field": 列名, "op": eq|ne|in|not_in|lt|lte|gt|gte|contains|is_empty|is_not_empty, "value": 値}
    か、それを {"and": [...]} / {"or": [...]} で組んだもの。sort は [{"field": 列名, "dir": "asc"|"desc"}]。
    q は名前などへの部分一致。参照先の表示名は応答の references に入る。
    """
    me = _me()
    params: dict[str, Any] = {"limit": max(0, min(limit, MAX_LIMIT)), "offset": max(0, offset)}
    if filter:
        params["filter"] = filter
    if sort:
        params["sort"] = sort
    if q:
        params["q"] = q
    result: dict[str, Any] = _call(lambda conn: service.query(conn, table, params, me))
    return result


def get_record(table: str, id: str, include_timeline: bool = False) -> dict[str, Any]:
    """1 件を読む。include_timeline で、そのレコードの時系列(活動・言及・完了したタスク)も付ける。"""
    _me()

    def fn(conn: Connection) -> dict[str, Any]:
        record = service.find(conn, table, id)
        if include_timeline:
            record["timeline"] = timeline(conn, table, id)
        return record

    result: dict[str, Any] = _call(fn)
    return result


def create_record(table: str, values: dict[str, Any]) -> dict[str, Any]:
    """レコードを 1 件作る。values は 列名 → 値。必須の項目と型は画面と同じく確かめる(間違いは理由付きで返る)。"""
    me = _me()
    result: dict[str, Any] = _call(lambda conn: service.insert(conn, table, values, me))
    return result


def update_record(table: str, id: str, values: dict[str, Any]) -> dict[str, Any]:
    """レコードの一部の列を書き換える。渡した列だけが変わる。タスクの完了は {"status": "done"}。"""
    me = _me()
    result: dict[str, Any] = _call(lambda conn: service.update(conn, table, id, values, me))
    return result


def build() -> MCPServer:
    settings = get_settings()
    issuer = settings.public_url.rstrip("/")
    server = MCPServer(
        name="Works",
        instructions=INSTRUCTIONS,
        website_url=issuer,
        auth_server_provider=WorksOAuthProvider(),
        auth=AuthSettings(
            issuer_url=AnyHttpUrl(issuer),
            resource_server_url=AnyHttpUrl(mcp_url()),
            validate_token_resource=True,
            required_scopes=[SCOPE],
            client_registration_options=ClientRegistrationOptions(
                enabled=True, valid_scopes=[SCOPE], default_scopes=[SCOPE]
            ),
            revocation_options=RevocationOptions(enabled=True),
        ),
    )
    for fn in (list_tables, search, list_records, get_record, create_record, update_record):
        server.tool()(fn)
    return server


def asgi_app(server: MCPServer) -> Starlette:
    """`/mcp` と OAuth の口(メタデータ・/authorize・/token・/register・/revoke)を持つ ASGI アプリ。

    状態を持たない形(stateless + JSON の応答)にする。1 プロセスで、接続を覚えておく必要が無いため。
    Host の検査(DNS rebinding 対策)は、公開 URL のホストと手元の web だけを通す。
    """
    host = urlparse(get_settings().public_url).netloc
    return server.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=True,
        json_response=True,
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=sorted({host, "127.0.0.1:8610", "localhost:8610"}),
            allowed_origins=sorted({get_settings().public_url.rstrip("/"), "https://claude.ai"}),
        ),
    )
