"""レコードの一覧(04 §2・§3・§4)。真理値と並びの意味は画面の `lib/filter.ts` と同じにする。"""

from collections.abc import Callable
from datetime import date, timedelta
from typing import Any

from fastapi.testclient import TestClient

Make = Callable[..., str]


def rows(response: Any) -> list[dict[str, Any]]:
    assert response.status_code == 200, response.text
    return response.json()["records"]


def q(client: TestClient, object_key: str, **params: Any) -> Any:
    return client.post(f"/api/v1/objects/{object_key}/records/query", json=params)


def test_未ログインでは一覧を読めない(client: TestClient) -> None:
    assert q(client, "accounts").status_code == 401


def test_論理削除した行は一覧に出ない(admin: TestClient, make: Make, conn: Any) -> None:
    from sqlalchemy import text

    alive = make("accounts", name="生きている会社")
    gone = make("accounts", name="消した会社")
    conn.execute(text("update accounts set deleted_at = now() where id = :id"), {"id": gone})
    names = [r["name"] for r in rows(q(admin, "accounts"))]
    assert "生きている会社" in names
    assert "消した会社" not in names
    assert alive != gone


def test_eq_は_NULL_に偽_ne_は_NULL_を含む(admin: TestClient, make: Make) -> None:
    make("accounts", name="種別あり", type="customer")
    make("accounts", name="種別なし")
    eq = [r["name"] for r in rows(q(admin, "accounts", filter={"field": "type", "op": "eq", "value": "prospect"}))]
    assert eq == []
    ne = [r["name"] for r in rows(q(admin, "accounts", filter={"field": "type", "op": "ne", "value": "customer"}))]
    assert "種別なし" in ne
    assert "種別あり" not in ne


def test_数値の列でも_ne_は_NULL_を含む(admin: TestClient, make: Make) -> None:
    """文字の列(空文字も「違う」)と、数値・日付の列(IS DISTINCT FROM)で経路が分かれる。"""
    make("opportunities", name="100 万", amount=1000000)
    make("opportunities", name="金額なし")
    got = [r["name"] for r in rows(q(admin, "opportunities", filter={"field": "amount", "op": "ne", "value": 1000000}))]
    assert got == ["金額なし"]


def test_not_in_は_NULL_を含み_in_は含まない(admin: TestClient, make: Make) -> None:
    make("accounts", name="顧客", type="customer")
    make("accounts", name="空")
    in_ = [r["name"] for r in rows(q(admin, "accounts", filter={"field": "type", "op": "in", "value": ["customer"]}))]
    assert in_ == ["顧客"]
    not_in = [
        r["name"] for r in rows(q(admin, "accounts", filter={"field": "type", "op": "not_in", "value": ["customer"]}))
    ]
    assert "空" in not_in
    assert "顧客" not in not_in


def test_大小の比較は_NULL_に偽(admin: TestClient, make: Make) -> None:
    make("opportunities", name="金額あり", amount=1000)
    make("opportunities", name="金額なし")
    got = [r["name"] for r in rows(q(admin, "opportunities", filter={"field": "amount", "op": "gte", "value": 0}))]
    assert got == ["金額あり"]


def test_is_empty_は_NULL_と空文字と空の配列(admin: TestClient, make: Make) -> None:
    make("tasks", title="空文字", description="")
    make("tasks", title="NULL")
    make("tasks", title="ラベル空", labels=[])
    make("tasks", title="ラベルあり", labels=["sales"])
    empty = [r["title"] for r in rows(q(admin, "tasks", filter={"field": "description", "op": "is_empty"}))]
    assert {"空文字", "NULL"} <= set(empty)
    labels_empty = [r["title"] for r in rows(q(admin, "tasks", filter={"field": "labels", "op": "is_empty"}))]
    assert "ラベル空" in labels_empty
    assert "ラベルあり" not in labels_empty


def test_複数選択は_どれかを含む_と_どれも含まない(admin: TestClient, make: Make) -> None:
    make("tasks", title="営業", labels=["sales", "urgent"])
    make("tasks", title="事務", labels=["office"])
    make("tasks", title="無印")
    hit = [r["title"] for r in rows(q(admin, "tasks", filter={"field": "labels", "op": "in", "value": ["sales"]}))]
    assert hit == ["営業"]
    miss = [r["title"] for r in rows(q(admin, "tasks", filter={"field": "labels", "op": "not_in", "value": ["sales"]}))]
    assert {"事務", "無印"} <= set(miss)
    assert "営業" not in miss


def test_複数選択は_JSON_の文字列で返る(admin: TestClient, make: Make) -> None:
    make("tasks", title="ラベル", labels=["sales", "urgent"])
    record = rows(q(admin, "tasks", filter={"field": "title", "op": "eq", "value": "ラベル"}))[0]
    assert record["labels"] == '["sales","urgent"]'


def test_contains_は大文字小文字を区別しない(admin: TestClient, make: Make) -> None:
    make("accounts", name="Alpha 商会")
    got = [r["name"] for r in rows(q(admin, "accounts", filter={"field": "name", "op": "contains", "value": "alpha"}))]
    assert got == ["Alpha 商会"]


def test_today_のマクロはワークスペースの時刻帯で解かれる(admin: TestClient, make: Make) -> None:
    today = date.today()
    make("tasks", title="今日", due_date=today)
    make("tasks", title="来週", due_date=today + timedelta(days=7))
    got = [r["title"] for r in rows(q(admin, "tasks", filter={"field": "due_date", "op": "lte", "value": "$today"}))]
    assert got == ["今日"]
    week = [r["title"] for r in rows(q(admin, "tasks", filter={"field": "due_date", "op": "lte", "value": "$today+7"}))]
    assert {"今日", "来週"} <= set(week)


def test_me_のマクロはログインしている利用者(admin: TestClient, make: Make) -> None:
    from tests.conftest import ADMIN_ID, MEMBER_ID

    make("tasks", title="自分の", assignee_id=ADMIN_ID)
    make("tasks", title="他人の", assignee_id=MEMBER_ID)
    got = [r["title"] for r in rows(q(admin, "tasks", filter={"field": "assignee_id", "op": "eq", "value": "$me"}))]
    assert got == ["自分の"]


def test_選択肢は定義順に並ぶ(admin: TestClient, make: Make) -> None:
    for stage in ("negotiation", "lead", "proposal"):
        make("opportunities", name=stage, stage=stage)
    got = [r["name"] for r in rows(q(admin, "opportunities", sort=[{"field": "stage", "dir": "asc"}]))]
    # 値の文字順(lead, negotiation, proposal)ではなく、選択肢の定義順(04 §4)
    assert got == ["lead", "proposal", "negotiation"]


def test_NULL_は昇順でも降順でも末尾(admin: TestClient, make: Make) -> None:
    make("opportunities", name="あり", amount=100)
    make("opportunities", name="なし")
    asc = [r["name"] for r in rows(q(admin, "opportunities", sort=[{"field": "amount", "dir": "asc"}]))]
    desc = [r["name"] for r in rows(q(admin, "opportunities", sort=[{"field": "amount", "dir": "desc"}]))]
    assert asc[-1] == "なし"
    assert desc[-1] == "なし"


def test_参照の列は参照先の表示名で並ぶ(admin: TestClient, make: Make) -> None:
    a = make("accounts", name="あ商事")
    z = make("accounts", name="ん物産")
    make("opportunities", name="後", account_id=z)
    make("opportunities", name="先", account_id=a)
    got = [r["name"] for r in rows(q(admin, "opportunities", sort=[{"field": "account_id", "dir": "asc"}]))]
    assert got == ["先", "後"]


def test_絞り込みはひらがなカタカナと全角半角を区別しない(admin: TestClient, make: Make) -> None:
    make("accounts", name="カタカナ商会")
    make("contacts", name="無関係")
    assert [r["name"] for r in rows(q(admin, "accounts", q="かたかな"))] == ["カタカナ商会"]
    assert [r["name"] for r in rows(q(admin, "accounts", q="ｶﾀｶﾅ"))] == ["カタカナ商会"]


def test_参照先の表示名が_references_に付く(admin: TestClient, make: Make) -> None:
    from tests.conftest import ADMIN_ID

    account = make("accounts", name="参照される会社", industry="manufacturing")
    make("opportunities", name="商談", account_id=account, owner_id=ADMIN_ID)
    body = q(admin, "opportunities", filter={"field": "name", "op": "eq", "value": "商談"}).json()
    assert body["references"]["accounts"][account] == {
        "id": account,
        "name": "参照される会社",
        # subtitle は選択肢のラベル(生の値ではない)
        "subtitle": "製造",
    }
    assert body["references"]["users"][ADMIN_ID]["name"] == "Takuya"


def test_関連先_polymorphic_も_references_に入る(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="関連先の会社")
    make("tasks", title="関連あり", related_object="accounts", related_id=account)
    body = q(admin, "tasks", filter={"field": "title", "op": "eq", "value": "関連あり"}).json()
    assert body["references"]["accounts"][account]["name"] == "関連先の会社"


def test_件数と_limit_と_offset(admin: TestClient, make: Make) -> None:
    for i in range(5):
        make("accounts", name=f"会社{i}")
    body = q(admin, "accounts", sort=[{"field": "name", "dir": "asc"}], limit=2, offset=1).json()
    assert body["total"] == 5
    assert [r["name"] for r in body["records"]] == ["会社1", "会社2"]
    # limit: 0 は件数だけ(レポートの分母などに使う)
    assert q(admin, "accounts", limit=0).json() == {"records": [], "total": 5, "references": {}}


def test_知らない項目の条件は_400(admin: TestClient) -> None:
    response = q(admin, "accounts", filter={"field": "nope", "op": "eq", "value": 1})
    assert response.status_code == 400
    assert response.json()["code"] == "invalid"


def test_1_件の取得と_404(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="1 件だけ")
    body = admin.get(f"/api/v1/objects/accounts/records/{account}").json()
    assert body["record"]["name"] == "1 件だけ"
    missing = admin.get("/api/v1/objects/accounts/records/00000000-0000-7000-8000-000000000000")
    assert missing.status_code == 404


def test_無いテーブルは_404(admin: TestClient) -> None:
    assert q(admin, "nope").status_code == 404
