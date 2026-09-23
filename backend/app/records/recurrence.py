"""繰り返し(Todoist の型。02 §3)。正は画面の `lib/recurrence.ts` と モックの `applyRecurrence`。

完了にすると、その回は完了済みの行として残り、**次回のタスクをサーバが作る**。
完了を戻すと、その回から自動で作った次回(まだ未着手のもの)を消す。
"""

import calendar
from datetime import date, timedelta
from typing import Any

RULES = ("daily", "weekdays", "weekly", "biweekly", "monthly", "yearly")


def _add_months_keep_day(base: date, months: int) -> date:
    """日を保ったまま n か月進める。翌月にその日が無ければ月末(1/31 → 2/28)。"""
    total = base.year * 12 + (base.month - 1) + months
    year, month = total // 12, total % 12 + 1
    return date(year, month, min(base.day, calendar.monthrange(year, month)[1]))


def next_due(base: date, rule: str) -> date | None:
    if rule == "daily":
        return base + timedelta(days=1)
    if rule == "weekdays":
        moved = base + timedelta(days=1)
        while moved.weekday() >= 5:
            moved += timedelta(days=1)
        return moved
    if rule == "weekly":
        return base + timedelta(days=7)
    if rule == "biweekly":
        return base + timedelta(days=14)
    if rule == "monthly":
        return _add_months_keep_day(base, 1)
    if rule == "yearly":
        # 2/29 は翌年 2/28 に
        return _add_months_keep_day(base, 12)
    return None


def due_field_of(obj: dict[str, Any]) -> str | None:
    completion = obj.get("completion") or {}
    if completion.get("due_field"):
        return str(completion["due_field"])
    field = next((f for f in obj["fields"] if f.get("semantic") == "deadline"), None)
    return field["key"] if field else None


def copy_for_next(obj: dict[str, Any], row: dict[str, Any], due: date) -> dict[str, Any]:
    """次回のタスクに写す値。完了の状況と完了日時は写さない(作成と同じ経路に渡す)。"""
    completion = obj["completion"]
    out: dict[str, Any] = {}
    for field in obj["fields"]:
        cols = field.get("columns")
        if cols:
            out[cols["object"]] = row.get(cols["object"])
            out[cols["id"]] = row.get(cols["id"])
            continue
        if field.get("readonly") or field["key"] in (completion["field"], completion.get("completed_at_field")):
            continue
        out[field["key"]] = row.get(field["key"])
    out[str(due_field_of(obj))] = due.isoformat()
    out[completion["field"]] = completion["open_value"]
    if completion.get("repeat_of_field"):
        out[completion["repeat_of_field"]] = row["id"]
    return out
