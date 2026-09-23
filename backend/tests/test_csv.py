"""CSV の取り込みと書き出し(04 §7)。文字から値への変換はサーバの仕事。"""

from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

Make = Callable[..., str]


def do_import(client: TestClient, object_key: str, **params: Any) -> dict[str, Any]:
    response = client.post(f"/api/v1/objects/{object_key}/import", json=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_見出しは項目名から推測される(admin: TestClient) -> None:
    body = do_import(admin, "accounts", csv="取引先名,種別\nアオバ精機,顧客\n")
    assert body["mapping"] == {"取引先名": "name", "種別": "type"}
    assert body["valid"] == 1
    record = admin.post("/api/v1/objects/accounts/records/query", json={"q": "アオバ"}).json()["records"][0]
    assert record["type"] == "customer"


def test_列名でも当たる_対応を指定すれば従う(admin: TestClient) -> None:
    body = do_import(admin, "accounts", csv="name,memo\nカワセ工業,無視される\n", mapping={"memo": None})
    assert body["mapping"] == {"name": "name", "memo": None}
    assert body["valid"] == 1


def test_数値と日付とチェックは文字から直す(admin: TestClient, make: Make) -> None:
    make("accounts", name="取引先A")
    csv = "商談名,取引先,金額,完了予定日\n新規案件,取引先A,\"￥1,200,000\",2026年10月3日\n"
    body = do_import(admin, "opportunities", csv=csv)
    assert body["errors"] == []
    record = admin.post("/api/v1/objects/opportunities/records/query", json={"q": "新規案件"}).json()["records"][0]
    assert record["amount"] == 1200000
    assert record["close_date"] == "2026-10-03"


def test_選択肢はラベルでも値でも受ける(admin: TestClient) -> None:
    do_import(admin, "accounts", csv="取引先名,種別\nラベル指定,パートナー\n値指定,prospect\n")
    rows = admin.post("/api/v1/objects/accounts/records/query", json={}).json()["records"]
    by_name = {r["name"]: r for r in rows}
    assert by_name["ラベル指定"]["type"] == "partner"
    assert by_name["値指定"]["type"] == "prospect"


def test_読めない行は飛ばして理由を返す(admin: TestClient) -> None:
    csv = "取引先名,種別\n良い行,顧客\n悪い行,そんな種別はない\n"
    body = do_import(admin, "accounts", csv=csv)
    assert body["total"] == 2
    assert body["valid"] == 1
    assert body["errors"][0]["line"] == 3
    assert "選択肢はありません" in body["errors"][0]["message"]


def test_必須が空の行は飛ばす(admin: TestClient) -> None:
    body = do_import(admin, "accounts", csv="取引先名,種別\n,顧客\n")
    assert body["valid"] == 0
    assert "取引先名が空です" in body["errors"][0]["message"]


def test_参照は表示名で引き_同名が複数なら行エラー(admin: TestClient, make: Make) -> None:
    make("accounts", name="ふたつある")
    make("accounts", name="ふたつある")
    make("accounts", name="ひとつだけ")
    body = do_import(
        admin, "opportunities", csv="商談名,取引先\n曖昧,ふたつある\n明確,ひとつだけ\n"
    )
    assert body["valid"] == 1
    assert "2 件あります" in body["errors"][0]["message"]


def test_参照は_UUID_でも指せる(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="ID で指す会社")
    body = do_import(admin, "opportunities", csv=f"商談名,取引先\nID 指定,{account}\n")
    assert body["valid"] == 1
    record = admin.post("/api/v1/objects/opportunities/records/query", json={"q": "ID 指定"}).json()["records"][0]
    assert record["account_id"] == account


def test_dry_run_は書き込まない(admin: TestClient) -> None:
    body = do_import(admin, "accounts", csv="取引先名\n試すだけ\n", dry_run=True)
    assert body["valid"] == 1
    assert body["created_ids"] == []
    assert admin.post("/api/v1/objects/accounts/records/query", json={"q": "試すだけ"}).json()["total"] == 0


def test_取り込みも業務ルールを通る(admin: TestClient) -> None:
    """既定値(担当は自分・優先度は P4)が入る。"""
    do_import(admin, "tasks", csv="件名\n取り込んだタスク\n")
    record = admin.post("/api/v1/objects/tasks/records/query", json={"q": "取り込んだ"}).json()["records"][0]
    assert record["priority"] == "p4"
    assert record["assignee_id"] is not None


def test_CSV_の並びのまま一覧に出る(admin: TestClient) -> None:
    body = do_import(admin, "accounts", csv="取引先名\n1 番目\n2 番目\n3 番目\n")
    assert len(body["created_ids"]) == 3
    rows = admin.post("/api/v1/objects/accounts/records/query", json={"sort": [{"field": "created_at", "dir": "desc"}]}).json()
    assert [r["name"] for r in rows["records"]] == ["1 番目", "2 番目", "3 番目"]


def test_タブ区切りも受ける(admin: TestClient) -> None:
    body = do_import(admin, "accounts", csv="取引先名\t種別\nタブ商会\t顧客\n")
    assert body["valid"] == 1


def test_引用符の中の改行とカンマ(admin: TestClient) -> None:
    csv = '取引先名,住所\n"改行あり","大阪市\n北区"\n'
    body = do_import(admin, "accounts", csv=csv)
    assert body["valid"] == 1
    record = admin.post("/api/v1/objects/accounts/records/query", json={"q": "改行あり"}).json()["records"][0]
    assert record["address"] == "大阪市\n北区"


def test_書き出しは項目名の見出しとラベルの値(admin: TestClient, make: Make) -> None:
    make("accounts", name="書き出す会社", type="customer")
    response = admin.post("/api/v1/objects/accounts/export", json={})
    assert response.status_code == 200
    text = response.content.decode("utf-8")
    assert text.startswith("﻿")  # Excel のための BOM
    lines = text.lstrip("﻿").splitlines()
    assert lines[0].startswith("取引先名,フリガナ,種別")
    assert any(line.startswith("書き出す会社,,顧客") for line in lines[1:])


def test_書き出しは絞り込みに従う(admin: TestClient, make: Make) -> None:
    make("accounts", name="出す会社", type="customer")
    make("accounts", name="出さない会社", type="prospect")
    response = admin.post(
        "/api/v1/objects/accounts/export", json={"filter": {"field": "type", "op": "eq", "value": "customer"}}
    )
    text = response.content.decode("utf-8")
    assert "出す会社" in text
    assert "出さない会社" not in text


def test_書き出した_CSV_をそのまま取り込める(admin: TestClient, make: Make) -> None:
    make("accounts", name="往復する会社", type="partner", industry="it")
    exported = admin.post("/api/v1/objects/accounts/export", json={}).content.decode("utf-8")
    body = do_import(admin, "accounts", csv=exported)
    assert body["errors"] == []
    assert body["valid"] >= 1
