"""Web フォームの受け口(04 §10)。**認証なし**で、外(Web サイト)から届く唯一の書き込み口。

守りは 4 つ: 有効なフォームか / bot 避けの隠し欄 / 間引き / ふつうの作成と同じ検証。
"""

import time
from collections import defaultdict, deque
from typing import Any

from sqlalchemy import Connection, func, select

from app.errors import bad_request, not_found, too_many_requests
from app.meta import store
from app.meta.tables import web_forms
from app.records import service
from app.records.csv_io import RowError, coerce

# 受け口ごと・送り元ごとの間引き(1 分に 10 件まで)。1 プロセスで持つ(利用者 1〜3 名の規模)
RATE_WINDOW = 60.0
RATE_LIMIT = 10
_recent: dict[tuple[str, str], deque[float]] = defaultdict(deque)

# 人には見えない欄。埋まっていたら bot(04 §10 の 3)
HONEYPOT = "_gotcha"


def allow(key: str, source: str) -> bool:
    now = time.monotonic()
    seen = _recent[(key, source)]
    while seen and now - seen[0] > RATE_WINDOW:
        seen.popleft()
    if len(seen) >= RATE_LIMIT:
        return False
    seen.append(now)
    return True


def reset_limits() -> None:
    _recent.clear()


def submit(conn: Connection, key: str, values: dict[str, Any], source: str) -> dict[str, Any] | None:
    """受け付けたら `RecordResponse`。bot と判断したときは `None`(呼び出し側が空の応答を返す)。"""
    row = conn.execute(select(web_forms).where(web_forms.c.key == key, web_forms.c.enabled.is_(True))).first()
    if row is None:
        raise not_found("このフォームは受け付けていません")
    objects = {o["key"]: o for o in store.all_objects(conn)}
    obj = objects.get(row.object_key)
    if obj is None:
        # テーブルが削除中なら受けない(定義の画面では「停止」として見せる)
        raise not_found("このフォームの先のテーブルがありません")
    if values.get(HONEYPOT):
        # 成功に見せて何もしない(レコードも submissions も増やさない。弾かれたと bot に気づかせない)
        return None
    if not allow(key, source):
        raise too_many_requests()

    timezone = store.get_workspace(conn)["timezone"]
    by_key = {f["key"]: f for f in obj["fields"]}
    accepted: dict[str, Any] = dict(row.defaults or {})
    for field_key in row.fields:
        if field_key not in values:
            continue
        field = by_key.get(field_key)
        if field is None:
            continue
        value = values[field_key]
        try:
            # form-urlencoded は全部が文字で届く。項目の型に直してから、ふつうの検証を通す
            accepted[field_key] = coerce(conn, field, value, timezone) if isinstance(value, str) else value
        except RowError as exc:
            raise bad_request(str(exc)) from exc
    created = service.insert(conn, row.object_key, accepted, None)
    conn.execute(
        web_forms.update()
        .where(web_forms.c.id == row.id)
        .values(submissions=web_forms.c.submissions + 1, last_submitted_at=func.clock_timestamp())
    )
    return created
