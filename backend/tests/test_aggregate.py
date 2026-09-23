"""集計(04 §5)と横断検索(04 §2)。"""

from collections.abc import Callable
from datetime import date, timedelta
from typing import Any

from fastapi.testclient import TestClient

Make = Callable[..., str]


def agg(client: TestClient, object_key: str, **params: Any) -> list[dict[str, Any]]:
    response = client.post(f"/api/v1/objects/{object_key}/aggregate", json=params)
    assert response.status_code == 200, response.text
    return response.json()["rows"]


def test_分けずに集計すると_1_行(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="会社")
    make("opportunities", name="A", account_id=account, amount=100)
    make("opportunities", name="B", account_id=account, amount=200)
    rows = agg(admin, "opportunities", measure={"op": "sum", "field": "amount"})
    assert rows == [{"key": None, "label": "", "value": 300}]
    assert agg(admin, "opportunities", measure={"op": "count"})[0]["value"] == 2


def test_確度を掛けた見込み金額(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="会社")
    make("opportunities", name="A", account_id=account, amount=1000, probability=50)
    make("opportunities", name="B", account_id=account, amount=1000, probability=10)
    rows = agg(admin, "opportunities", measure={"op": "sum", "field": "amount", "weight_field": "probability"})
    assert rows[0]["value"] == 600


def test_平均は値のある行だけ_行が無ければ_0(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="会社")
    make("opportunities", name="A", account_id=account, amount=100)
    make("opportunities", name="金額なし", account_id=account)
    assert agg(admin, "opportunities", measure={"op": "avg", "field": "amount"})[0]["value"] == 100
    empty = agg(
        admin,
        "opportunities",
        measure={"op": "avg", "field": "amount"},
        filter={"field": "name", "op": "eq", "value": "いない"},
    )
    assert empty[0]["value"] == 0


def test_選択肢で分けると定義順_ラベルと色が付く(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="会社")
    make("opportunities", name="A", account_id=account, stage="negotiation", amount=1)
    make("opportunities", name="B", account_id=account, stage="lead", amount=2)
    rows = agg(admin, "opportunities", group_by={"field": "stage"}, measure={"op": "count"})
    assert [r["key"] for r in rows] == ["lead", "negotiation"]
    assert rows[0]["label"] == "見込み"
    assert rows[0]["color"]


def test_value_desc_なら選択肢でも値の大きい順(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="会社")
    for stage in ("lead", "negotiation", "negotiation"):
        make("opportunities", name=stage, account_id=account, stage=stage)
    rows = agg(admin, "opportunities", group_by={"field": "stage"}, measure={"op": "count"}, order="value_desc")
    assert [r["key"] for r in rows] == ["negotiation", "lead"]


def test_値が空のグループは末尾で_未設定(admin: TestClient, make: Make) -> None:
    make("accounts", name="種別あり", type="customer")
    make("accounts", name="種別なし")
    rows = agg(admin, "accounts", group_by={"field": "type"}, measure={"op": "count"})
    assert rows[-1]["key"] is None
    assert rows[-1]["label"] == "未設定"


def test_参照で分けると参照先の名前がラベル(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="北浜ロジ")
    make("opportunities", name="A", account_id=account)
    rows = agg(admin, "opportunities", group_by={"field": "account_id"}, measure={"op": "count"})
    assert rows[0]["label"] == "北浜ロジ"


def test_関連先のテーブルで分けるとテーブルのラベル(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="会社")
    make("tasks", title="関連あり", related_object="accounts", related_id=account)
    make("tasks", title="関連なし")
    rows = agg(admin, "tasks", group_by={"field": "related_object"}, measure={"op": "count"})
    labels = {r["key"]: r["label"] for r in rows}
    assert labels["accounts"] == "取引先"
    assert labels[None] == "関連先なし"


def test_月でまとめると空の区間も_0_で返る(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="会社")
    today = date.today()
    make("opportunities", name="今月", account_id=account, close_date=today, amount=10)
    rows = agg(
        admin,
        "opportunities",
        group_by={"field": "close_date", "bucket": "month", "range": {"from": -2, "to": 0}},
        measure={"op": "sum", "field": "amount"},
    )
    assert len(rows) == 3
    assert rows[-1]["key"] == today.strftime("%Y-%m")
    assert rows[-1]["value"] == 10
    assert rows[0]["value"] == 0
    # 最初の区間だけ年を付ける(1 月は常に付く)
    assert rows[0]["label"].endswith("月")


def test_日でまとめる(admin: TestClient, make: Make) -> None:
    today = date.today()
    make("tasks", title="今日", due_date=today)
    rows = agg(
        admin,
        "tasks",
        group_by={"field": "due_date", "bucket": "day", "range": {"from": -1, "to": 1}},
        measure={"op": "count"},
    )
    assert [r["key"] for r in rows] == [
        (today - timedelta(days=1)).isoformat(),
        today.isoformat(),
        (today + timedelta(days=1)).isoformat(),
    ]
    assert rows[1]["value"] == 1
    assert rows[1]["label"] == f"{today.month}/{today.day}"


def test_上位_n_件だけ返す(admin: TestClient, make: Make) -> None:
    for i in range(4):
        make("accounts", name=f"会社{i}", industry="it" if i < 2 else "retail")
    rows = agg(admin, "accounts", group_by={"field": "industry"}, measure={"op": "count"}, limit=1)
    assert len(rows) == 1


def test_絞り込んでから集計する(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="会社")
    make("opportunities", name="受注", account_id=account, stage="won", amount=100)
    make("opportunities", name="交渉", account_id=account, stage="negotiation", amount=50)
    rows = agg(
        admin,
        "opportunities",
        filter={"field": "stage", "op": "not_in", "value": ["won", "lost"]},
        measure={"op": "sum", "field": "amount"},
    )
    assert rows[0]["value"] == 50


def test_知らない項目で分けると_400(admin: TestClient) -> None:
    response = admin.post(
        "/api/v1/objects/accounts/aggregate", json={"group_by": {"field": "nope"}, "measure": {"op": "count"}}
    )
    assert response.status_code == 400


def test_横断検索は全テーブルを探し_名前に当たったものが先(admin: TestClient, make: Make) -> None:
    make("accounts", name="カタカナ商会")
    account = make("accounts", name="別の会社", description="カタカナ商会と取引")
    make("contacts", name="片仮名太郎", account_id=account)
    hits = admin.get("/api/v1/search", params={"q": "かたかな"}).json()["hits"]
    names = [h["name"] for h in hits]
    assert names[0] == "カタカナ商会"
    assert "別の会社" in names
    assert {h["object"] for h in hits} == {"accounts"}


def test_検索の結果には所属の取引先が添う(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="所属の会社")
    make("contacts", name="山田一郎", account_id=account)
    hits = admin.get("/api/v1/search", params={"q": "山田"}).json()["hits"]
    assert hits[0]["subtitle"] == "所属の会社"


def test_空の検索は空(admin: TestClient) -> None:
    assert admin.get("/api/v1/search", params={"q": "  "}).json() == {"hits": []}


def test_削除したレコードは検索に出ない(admin: TestClient, make: Make, conn: Any) -> None:
    from sqlalchemy import text

    account = make("accounts", name="消える会社")
    conn.execute(text("update accounts set deleted_at = now() where id = :id"), {"id": account})
    assert admin.get("/api/v1/search", params={"q": "消える"}).json()["hits"] == []
