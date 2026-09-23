"""サーバ側の業務ルール(02 §3)。**画面に同じ計算を持たせない**ので、書き込みは必ずここを通る。

正はモックの `applyRules`。繰り返し(次回のタスクを作る)と richtext の洗浄・言及は J-036 で足す。
"""

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo


def today_in(timezone: str) -> str:
    return datetime.now(ZoneInfo(timezone)).date().isoformat()


def defaults_for_insert(obj: dict[str, Any], me: str | None, timezone: str) -> dict[str, Any]:
    """作成時の既定値(02 §3)。**検証より先に埋める**ので、Web フォームや MCP から省いても通る。"""
    defaults: dict[str, Any] = {}
    for field in obj["fields"]:
        if field["type"] == "select" and field.get("required"):
            options = field.get("options") or []
            defaults[field["key"]] = options[0]["value"] if options else None
        if field["type"] == "user":
            defaults[field["key"]] = me
    # タスクの優先度は P4(02 §3)。項目の定義に既定値を持たせる仕組みがまだ無いので、ここで見ている
    if obj["key"] == "tasks":
        defaults["priority"] = "p4"
    timeline = obj.get("timeline")
    if timeline:
        defaults[timeline["date"]] = today_in(timezone)
    return defaults


def apply_rules(
    obj: dict[str, Any],
    before: dict[str, Any] | None,
    next_row: dict[str, Any],
    patch: dict[str, Any],
    *,
    now: str,
    timezone: str,
) -> dict[str, Any]:
    """書き込みの直前に効かせる規則。`next_row` を変えた結果を返す。"""
    out = dict(next_row)
    completion = obj.get("completion")
    if completion and completion.get("completed_at_field") and completion["field"] in patch:
        done = completion["done_value"]
        was_done = before is not None and before.get(completion["field"]) == done
        is_done = out.get(completion["field"]) == done
        at = completion["completed_at_field"]
        # 完了日時を一緒に渡されたら尊重する(移行で元の日時を保つため。04 §11)
        if is_done and not was_done and not patch.get(at):
            out[at] = now
        if not is_done:
            out[at] = None
    timeline = obj.get("timeline")
    if timeline and not out.get(timeline["date"]):
        out[timeline["date"]] = today_in(timezone)
    # 商談のフェーズを変えたら、確度をそのフェーズの既定値に(同時に確度を指定したときは尊重する)
    if obj["key"] == "opportunities" and "stage" in patch and "probability" not in patch:
        stage_field = next((f for f in obj["fields"] if f["key"] == "stage"), None)
        option = next(
            (o for o in (stage_field or {}).get("options") or [] if o["value"] == out.get("stage")),
            None,
        )
        if option and option.get("probability") is not None:
            out["probability"] = option["probability"]
    return out
