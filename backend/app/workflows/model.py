"""ワークフローの定義の形(04 §15)。画面から来た本文(`WorkflowInput`)を確かめて整える。正はモックの `checkWorkflow`。

形:
- `trigger`: `{ event: "created" | "matched", filter?: Filter, origins: [...] }`
  - `created`(作成されたとき): 条件は任意。あれば、作ったレコードが満たすときだけ
  - `matched`(条件を満たしたとき): 条件は必須。作成・更新で、満たしていなかったものが満たした瞬間に 1 回
  - `origins`: どこからの書き込みで動かすか(`app` / `form` / `mcp` / `auto` / `import`)。1 つ以上
- `actions`: `[{ id, type, … }]`。1〜10 個。`id` はアクションを見分ける名前で、画面が振る(実行記録が指す)
"""

from typing import Any

from sqlalchemy import Connection

from app.errors import ApiError, bad_request
from app.meta import store
from app.records.filters import Context, compile_filter
from app.records.origin import ORIGIN_KINDS
from app.records.tables import fields_by_column, table_of
from app.workflows.actions import kinds

EVENTS = ("created", "matched")
MAX_NAME = 80
MAX_ACTIONS = 10
MAX_ACTION_ID = 64
# 条件の入れ子の深さ(ビューの画面が作るのは 2 段まで)
MAX_DEPTH = 4


def _walk_values(filter_: Any, depth: int = 0) -> list[Any]:
    """条件の形を確かめながら、値を全部集める。"""
    if depth > MAX_DEPTH:
        raise bad_request("条件の入れ子が深すぎます")
    if not isinstance(filter_, dict):
        raise bad_request("条件の形が正しくありません")
    for key in ("and", "or"):
        if key in filter_:
            parts = filter_[key]
            if not isinstance(parts, list):
                raise bad_request("条件の形が正しくありません")
            out: list[Any] = []
            for part in parts:
                out += _walk_values(part, depth + 1)
            return out
    value = filter_.get("value")
    return value if isinstance(value, list) else [value]


def check_filter(obj: dict[str, Any], filter_: Any) -> dict[str, Any] | None:
    """条件を確かめる。**ビューと同じ関数で SQL に訳してみる**(無い項目・型に合わない値はここで 400)。"""
    if not filter_:
        return None
    if "$me" in _walk_values(filter_):
        # ワークフローは誰の書き込みでも動くので、「自分」が誰か決まらない
        raise bad_request("ワークフローの条件に「自分」は使えません。利用者を名指ししてください")
    try:
        compile_filter(table_of(obj), fields_by_column(obj), filter_, Context(timezone="UTC", me=None))
    except ApiError as exc:
        raise bad_request(f"条件が正しくありません: {exc.message}") from exc
    return dict(filter_)


def check(conn: Connection, body: dict[str, Any]) -> dict[str, Any]:
    """`WorkflowInput` を確かめて、DB に入れる形(列名 → 値)にする。"""
    name = str(body.get("name") or "").strip()
    if not name:
        raise bad_request("ワークフローの名前を入力してください")
    if len(name) > MAX_NAME:
        raise bad_request(f"ワークフローの名前は {MAX_NAME} 文字までです")
    objects = {o["key"]: o for o in store.live_objects(conn)}
    obj = objects.get(str(body.get("object") or ""))
    if obj is None:
        raise bad_request("テーブルを選んでください")

    trigger = body.get("trigger")
    if not isinstance(trigger, dict) or trigger.get("event") not in EVENTS:
        raise bad_request("「いつ動かすか」を選んでください")
    filter_ = check_filter(obj, trigger.get("filter"))
    if trigger["event"] == "matched" and filter_ is None:
        raise bad_request("「条件を満たしたとき」には、条件を 1 つ以上入れてください")
    raw_origins = trigger.get("origins")
    if not isinstance(raw_origins, list) or any(o not in ORIGIN_KINDS for o in raw_origins):
        raise bad_request("どこからの書き込みで動かすかが正しくありません")
    origins = [o for o in ORIGIN_KINDS if o in raw_origins]
    if not origins:
        raise bad_request("どこからの書き込みで動かすかを 1 つ以上選んでください")
    checked_trigger: dict[str, Any] = {"event": trigger["event"], "origins": origins}
    if filter_ is not None:
        checked_trigger["filter"] = filter_

    raw_actions = body.get("actions")
    if not isinstance(raw_actions, list) or not raw_actions:
        raise bad_request("アクションを 1 つ以上足してください")
    if len(raw_actions) > MAX_ACTIONS:
        raise bad_request(f"アクションは {MAX_ACTIONS} 個までです")
    known = kinds()
    actions: list[dict[str, Any]] = []
    seen: set[str] = set()
    for action in raw_actions:
        if not isinstance(action, dict):
            raise bad_request("アクションの形が正しくありません")
        action_id = action.get("id")
        if not isinstance(action_id, str) or not action_id or len(action_id) > MAX_ACTION_ID or action_id in seen:
            raise bad_request("アクションの id が正しくありません(重ならない文字で)")
        seen.add(action_id)
        kind = known.get(str(action.get("type")))
        if kind is None:
            raise bad_request(f"知らないアクションです: {action.get('type')!r}")
        actions.append(kind.check(conn, obj, action))

    enabled = body.get("enabled", True)
    if not isinstance(enabled, bool):
        raise bad_request("オン/オフは真偽で指定してください")
    return {"name": name, "object_key": obj["key"], "enabled": enabled, "trigger": checked_trigger, "actions": actions}


def filter_fields(filter_: Any) -> list[str]:
    """条件が指している列名(問題の表示に使う)。"""
    if not isinstance(filter_, dict):
        return []
    for key in ("and", "or"):
        if key in filter_:
            out: list[str] = []
            for part in filter_[key] or []:
                out += filter_fields(part)
            return out
    field = filter_.get("field")
    return [field] if isinstance(field, str) else []
