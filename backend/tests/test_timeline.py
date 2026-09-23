"""時系列(04 §9)、書式付きの文字の洗浄と `@` の言及(04 §1)、繰り返し(02 §3)。"""

from collections.abc import Callable
from datetime import date, timedelta
from typing import Any

from fastapi.testclient import TestClient

Make = Callable[..., str]


def create(client: TestClient, object_key: str, **values: Any) -> dict[str, Any]:
    response = client.post(f"/api/v1/objects/{object_key}/records", json=values)
    assert response.status_code == 200, response.text
    return response.json()["record"]


def entries(client: TestClient, object_key: str, record_id: str) -> list[dict[str, Any]]:
    response = client.get(f"/api/v1/objects/{object_key}/records/{record_id}/timeline")
    assert response.status_code == 200, response.text
    return response.json()["entries"]


def test_許した要素だけを残す(admin: TestClient) -> None:
    activity = create(
        admin,
        "activities",
        subject="洗浄",
        body="<p>太字は<strong>残す</strong></p><script>alert(1)</script><div>div は剥がす</div>",
    )
    assert "<strong>残す</strong>" in activity["body"]
    assert "script" not in activity["body"]
    assert "<div>" not in activity["body"]
    assert "div は剥がす" in activity["body"]


def test_危ないリンクは_href_を落とす(admin: TestClient) -> None:
    activity = create(admin, "activities", subject="リンク", body='<p><a href="javascript:alert(1)">押すな</a></p>')
    assert "javascript:" not in activity["body"]
    good = create(admin, "activities", subject="リンク", body='<p><a href="https://example.jp">よい</a></p>')
    assert 'href="https://example.jp"' in good["body"]
    assert 'rel="noreferrer"' in good["body"]


def test_言及は_mentions_に写る(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="北浜ロジ")
    mention = f'<span data-type="mention" data-id="accounts:{account}" data-label="北浜ロジ">@北浜ロジ</span>'
    body = f"<p>打ち合わせ {mention}</p>"
    activity = create(admin, "activities", subject="言及", body=body)
    assert activity["mentions"] == f'["accounts:{account}"]'


def test_形の違う言及は写さない(admin: TestClient) -> None:
    body = '<p><span data-type="mention" data-id="こわれた">@こわれた</span></p>'
    activity = create(admin, "activities", subject="壊れた言及", body=body)
    assert activity["mentions"] is None


def test_関連先の活動が時系列に出る(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="取引先")
    activity = create(
        admin, "activities", subject="訪問した", type="visit", related_object="accounts", related_id=account
    )
    got = entries(admin, "accounts", account)
    assert len(got) == 1
    assert got[0]["kind"] == "activity"
    assert got[0]["id"] == activity["id"]
    assert got[0]["subject"] == "訪問した"
    assert got[0]["type"]["value"] == "visit"
    assert got[0]["related"]["name"] == "取引先"


def test_言及された側の時系列にも出る(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="言及される会社")
    other = make("accounts", name="本来の関連先")
    mention = f'<span data-type="mention" data-id="accounts:{account}" data-label="言及">@言及</span>'
    body = f"<p>{mention}</p>"
    create(admin, "activities", subject="言及つき", body=body, related_object="accounts", related_id=other)
    got = entries(admin, "accounts", account)
    assert [e["kind"] for e in got] == ["mention"]
    # 本来の関連先を添える(開いているレコードと違うので)
    assert got[0]["related"]["id"] == other


def test_完了したタスクは複製せずに時系列へ合成される(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="タスクの関連先")
    task = create(admin, "tasks", title="電話する", related_object="accounts", related_id=account, description="要点")
    assert entries(admin, "accounts", account) == []
    admin.patch(f"/api/v1/objects/tasks/records/{task['id']}", json={"status": "done"})
    got = entries(admin, "accounts", account)
    assert [e["kind"] for e in got] == ["completion"]
    assert got[0]["subject"] == "電話する"
    assert got[0]["body"] == "<p>要点</p>"
    # 活動のテーブルには増えていない(02 §3)
    assert admin.post("/api/v1/objects/activities/records/query", json={}).json()["total"] == 0


def test_時系列は新しい順(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="並び")
    for day in ("2026-01-01", "2026-03-01", "2026-02-01"):
        create(
            admin,
            "activities",
            subject=day,
            occurred_on=day,
            related_object="accounts",
            related_id=account,
        )
    assert [e["subject"] for e in entries(admin, "accounts", account)] == ["2026-03-01", "2026-02-01", "2026-01-01"]


def test_無いテーブルの時系列は_404(admin: TestClient) -> None:
    missing = "01000000-0000-7000-8000-00000000ffff"
    assert admin.get(f"/api/v1/objects/nope/records/{missing}/timeline").status_code == 404


def test_繰り返しのタスクは完了で次回が作られる(admin: TestClient) -> None:
    task = create(admin, "tasks", title="毎週の報告", due_date="2026-09-21", repeat="weekly")
    admin.patch(f"/api/v1/objects/tasks/records/{task['id']}", json={"status": "done"})
    rows = admin.post("/api/v1/objects/tasks/records/query", json={"q": "毎週の報告"}).json()["records"]
    assert len(rows) == 2
    nxt = next(r for r in rows if r["id"] != task["id"])
    # 元の期限から数える(Todoist の every)
    assert nxt["due_date"] == "2026-09-28"
    assert nxt["status"] == "open"
    assert nxt["repeat_of"] == task["id"]
    assert nxt["repeat"] == "weekly"


def test_完了した日から数える指定(admin: TestClient) -> None:
    task = create(
        admin,
        "tasks",
        title="完了日から",
        due_date="2020-01-01",
        repeat="daily",
        repeat_from_completion=True,
    )
    admin.patch(f"/api/v1/objects/tasks/records/{task['id']}", json={"status": "done"})
    rows = admin.post("/api/v1/objects/tasks/records/query", json={"q": "完了日から"}).json()["records"]
    nxt = next(r for r in rows if r["id"] != task["id"])
    assert nxt["due_date"] == (date.today() + timedelta(days=1)).isoformat()


def test_完了を戻すと次回が消える(admin: TestClient) -> None:
    task = create(admin, "tasks", title="戻す", due_date="2026-09-21", repeat="weekly")
    admin.patch(f"/api/v1/objects/tasks/records/{task['id']}", json={"status": "done"})
    assert admin.post("/api/v1/objects/tasks/records/query", json={"q": "戻す"}).json()["total"] == 2
    admin.patch(f"/api/v1/objects/tasks/records/{task['id']}", json={"status": "open"})
    rows = admin.post("/api/v1/objects/tasks/records/query", json={"q": "戻す"}).json()["records"]
    assert [r["id"] for r in rows] == [task["id"]]


def test_二重に完了を送っても次回は_1_つ(admin: TestClient) -> None:
    task = create(admin, "tasks", title="二重", due_date="2026-09-21", repeat="weekly")
    for _ in range(2):
        admin.patch(f"/api/v1/objects/tasks/records/{task['id']}", json={"status": "done"})
    assert admin.post("/api/v1/objects/tasks/records/query", json={"q": "二重"}).json()["total"] == 2


def test_繰り返しでないタスクは次回を作らない(admin: TestClient) -> None:
    task = create(admin, "tasks", title="一回きり", due_date="2026-09-21")
    admin.patch(f"/api/v1/objects/tasks/records/{task['id']}", json={"status": "done"})
    assert admin.post("/api/v1/objects/tasks/records/query", json={"q": "一回きり"}).json()["total"] == 1


def test_月末をまたぐ繰り返しは月末に寄せる(admin: TestClient) -> None:
    task = create(admin, "tasks", title="月末", due_date="2026-01-31", repeat="monthly")
    admin.patch(f"/api/v1/objects/tasks/records/{task['id']}", json={"status": "done"})
    rows = admin.post("/api/v1/objects/tasks/records/query", json={"q": "月末"}).json()["records"]
    nxt = next(r for r in rows if r["id"] != task["id"])
    assert nxt["due_date"] == "2026-02-28"


def test_平日の繰り返しは土日を飛ばす(admin: TestClient) -> None:
    # 2026-09-25 は金曜。次は月曜 2026-09-28
    task = create(admin, "tasks", title="平日", due_date="2026-09-25", repeat="weekdays")
    admin.patch(f"/api/v1/objects/tasks/records/{task['id']}", json={"status": "done"})
    rows = admin.post("/api/v1/objects/tasks/records/query", json={"q": "平日"}).json()["records"]
    nxt = next(r for r in rows if r["id"] != task["id"])
    assert nxt["due_date"] == "2026-09-28"
