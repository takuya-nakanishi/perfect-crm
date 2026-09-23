"""レコードの作成・更新・削除・復元(04 §2・§11、業務ルールは 02 §3)。"""

from collections.abc import Callable
from datetime import date
from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import ADMIN_ID

Make = Callable[..., str]


def create(client: TestClient, object_key: str, **values: Any) -> Any:
    return client.post(f"/api/v1/objects/{object_key}/records", json=values)


def patch(client: TestClient, object_key: str, record_id: str, **values: Any) -> Any:
    return client.patch(f"/api/v1/objects/{object_key}/records/{record_id}", json=values)


def test_作成すると_id_と_作成日時_が付き_1_件で引ける(admin: TestClient) -> None:
    response = create(admin, "accounts", name="新しい会社")
    assert response.status_code == 200, response.text
    record = response.json()["record"]
    assert record["name"] == "新しい会社"
    assert record["id"] and record["created_at"] and record["updated_at"]
    assert admin.get(f"/api/v1/objects/accounts/records/{record['id']}").status_code == 200


def test_必須の項目が空なら_400(admin: TestClient) -> None:
    response = create(admin, "accounts", name="")
    assert response.status_code == 400
    assert "取引先名" in response.json()["message"]


def test_定義に無い列は_400(admin: TestClient) -> None:
    response = create(admin, "accounts", name="会社", nope="x")
    assert response.status_code == 400
    assert "定義に無い列です" in response.json()["message"]


def test_選択肢に無い値は_400(admin: TestClient) -> None:
    assert create(admin, "accounts", name="会社", type="nope").status_code == 400


def test_桁数を超えると_400(admin: TestClient) -> None:
    obj = next(o for o in admin.get("/api/v1/meta").json()["objects"] if o["key"] == "accounts")
    field = next((f for f in obj["fields"] if f.get("max_length")), None)
    if field is None:
        return
    over = "あ" * (int(field["max_length"]) + 1)
    assert create(admin, "accounts", name="会社", **{field["key"]: over}).status_code == 400


def test_数値の列に文字を渡すと_400(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="会社")
    assert create(admin, "opportunities", name="商談", account_id=account, amount="1000").status_code == 400


def test_日付の形が違えば_400(admin: TestClient) -> None:
    assert create(admin, "tasks", title="タスク", due_date="2026/09/30").status_code == 400
    assert create(admin, "tasks", title="タスク", due_date="2026-13-01").status_code == 400
    assert create(admin, "tasks", title="タスク", due_date="2026-09-30").status_code == 200


def test_参照先が無ければ_400(admin: TestClient) -> None:
    missing = "01000000-0000-7000-8000-00000000ffff"
    assert create(admin, "opportunities", name="商談", account_id=missing).status_code == 400


def test_関連先は組で指定する(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="関連先")
    assert create(admin, "tasks", title="片方だけ", related_object="accounts").status_code == 400
    assert create(admin, "tasks", title="対象外", related_object="contacts", related_id=account).status_code == 400
    assert create(admin, "tasks", title="正しい", related_object="accounts", related_id=account).status_code == 200


def test_作成時の既定値_担当は自分_優先度は_P4(admin: TestClient) -> None:
    record = create(admin, "tasks", title="既定値").json()["record"]
    assert record["assignee_id"] == ADMIN_ID
    assert record["priority"] == "p4"
    # 必須の選択肢は先頭の値
    assert record["status"] == "open"


def test_活動の日付は空なら今日(admin: TestClient) -> None:
    record = create(admin, "activities", subject="記録").json()["record"]
    assert record["occurred_on"] == date.today().isoformat()


def test_複数選択は重複を除いて定義順に揃う(admin: TestClient) -> None:
    # 選択肢の定義順は sales → admin → internal。渡した順や重複によらず、この順に揃う
    record = create(admin, "tasks", title="ラベル", labels='["internal","sales","internal"]').json()["record"]
    assert record["labels"] == '["sales","internal"]'


def test_複数選択に無い値は_400(admin: TestClient) -> None:
    assert create(admin, "tasks", title="ラベル", labels='["nope"]').status_code == 400
    assert create(admin, "tasks", title="ラベル", labels="sales").status_code == 400


def test_完了にすると完了日時が入り_戻すと消える(admin: TestClient) -> None:
    task = create(admin, "tasks", title="完了の規則").json()["record"]
    assert task["completed_at"] is None
    done = patch(admin, "tasks", task["id"], status="done").json()["record"]
    assert done["completed_at"] is not None
    back = patch(admin, "tasks", task["id"], status="open").json()["record"]
    assert back["completed_at"] is None


def test_完了日時を一緒に渡したら尊重する(admin: TestClient) -> None:
    """移行(J-026)で、元の完了日時を保つため(04 §11)。"""
    task = create(admin, "tasks", title="移行分").json()["record"]
    moved = patch(admin, "tasks", task["id"], status="done", completed_at="2020-01-02T03:04:05.000Z").json()["record"]
    assert moved["completed_at"] == "2020-01-02T03:04:05.000Z"


def test_商談のフェーズを変えると確度が既定値になる(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="会社")
    opportunity = create(admin, "opportunities", name="商談", account_id=account, stage="lead").json()["record"]
    moved = patch(admin, "opportunities", opportunity["id"], stage="negotiation").json()["record"]
    assert moved["probability"] == 85  # 交渉フェーズの既定値
    # 確度を同時に指定したときは尊重する
    kept = patch(admin, "opportunities", opportunity["id"], stage="proposal", probability=5).json()["record"]
    assert kept["probability"] == 5


def test_更新すると更新日時が進む(admin: TestClient) -> None:
    task = create(admin, "tasks", title="更新").json()["record"]
    after = patch(admin, "tasks", task["id"], title="更新した").json()["record"]
    assert after["title"] == "更新した"
    assert after["updated_at"] >= task["updated_at"]


def test_無いレコードの更新は_404(admin: TestClient) -> None:
    missing = "04000000-0000-7000-8000-00000000ffff"
    assert patch(admin, "tasks", missing, title="x").status_code == 404


def test_削除は論理削除で_元に戻せる(admin: TestClient) -> None:
    task = create(admin, "tasks", title="消す").json()["record"]
    assert admin.delete(f"/api/v1/objects/tasks/records/{task['id']}").status_code == 204
    assert admin.get(f"/api/v1/objects/tasks/records/{task['id']}").status_code == 404
    # 2 回消しても 404(冪等でない側を選んだのは、画面が「元に戻す」で守るため)
    assert admin.delete(f"/api/v1/objects/tasks/records/{task['id']}").status_code == 404
    restored = admin.post(f"/api/v1/objects/tasks/records/{task['id']}/restore")
    assert restored.status_code == 200
    assert restored.json()["record"]["title"] == "消す"
    assert admin.get(f"/api/v1/objects/tasks/records/{task['id']}").status_code == 200


def test_消えていないレコードの復元は_404(admin: TestClient) -> None:
    task = create(admin, "tasks", title="生きている").json()["record"]
    assert admin.post(f"/api/v1/objects/tasks/records/{task['id']}/restore").status_code == 404


def test_作成した行は絞り込みでも見つかる(admin: TestClient) -> None:
    create(admin, "accounts", name="カタカナ工業")
    found = admin.post("/api/v1/objects/accounts/records/query", json={"q": "かたかな"}).json()
    assert [r["name"] for r in found["records"]] == ["カタカナ工業"]


def test_更新すると絞り込みの索引も追いつく(admin: TestClient) -> None:
    account = create(admin, "accounts", name="旧名称").json()["record"]
    patch(admin, "accounts", account["id"], name="新名称")
    assert admin.post("/api/v1/objects/accounts/records/query", json={"q": "旧名称"}).json()["total"] == 0
    assert admin.post("/api/v1/objects/accounts/records/query", json={"q": "新名称"}).json()["total"] == 1
