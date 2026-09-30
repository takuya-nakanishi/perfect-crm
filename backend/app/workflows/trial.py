"""ワークフローの「テスト送信」(04 §15)。保存前の定義のまま、アクションをその場で 1 回動かす。

レコードは、そのテーブルで条件を満たす最新の 1 件(無ければ、条件を外した最新の 1 件。それも無ければ見本の値)。
実行記録には残さない(本物の出来事ではない)。Slack のチャンネルの最終送信・失敗には残る(チャンネルの状態なので)。
"""

from typing import Any

from sqlalchemy import Connection

from app.meta import store as meta_store
from app.records import origin, service
from app.workflows import model
from app.workflows.actions import Firing, kinds


def _latest(conn: Connection, object_key: str, filter_: Any, me: str) -> dict[str, Any] | None:
    newest = [{"field": "created_at", "dir": "desc"}]
    tries: list[dict[str, Any]] = [{"filter": filter_, "sort": newest, "limit": 1}] if filter_ else []
    tries.append({"sort": newest, "limit": 1})
    for params in tries:
        found = service.query(conn, object_key, params, me)["records"]
        if found:
            return dict(found[0])
    return None


def run(conn: Connection, body: dict[str, Any], me: str) -> dict[str, Any]:
    values = model.check(conn, body)
    obj = meta_store.object_meta(conn, values["object_key"])
    trigger = values["trigger"]
    record = _latest(conn, obj["key"], trigger.get("filter"), me)
    firing = Firing("test", values["name"], obj, record, trigger["event"], origin.app(me), test=True)
    known = kinds()
    results = []
    for action in values["actions"]:
        kind = known[action["type"]]
        outcome = kind.execute(kind.prepare(conn, firing, action))
        results.append({"action_id": action["id"], "ok": outcome.status == "done", "error": outcome.error})
    name = str(record.get(obj["name_field"]) or "").strip() if record else None
    return {"record": {"id": record["id"], "name": name or "(名前なし)"} if record else None, "results": results}
