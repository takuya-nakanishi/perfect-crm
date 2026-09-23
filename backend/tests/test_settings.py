"""環境設定(04 §10): MCP のアクセストークンと Web フォーム。管理者の制限は 03 §5。"""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.settings import forms as form_service

Make = Callable[..., str]


@pytest.fixture(autouse=True)
def _reset_limits() -> None:
    form_service.reset_limits()


def make_form(client: TestClient, **extra: Any) -> dict[str, Any]:
    body = {
        "name": "お問い合わせ",
        "object": "contacts",
        "fields": ["name", "email", "description"],
        "defaults": {"status": "new"},
        "enabled": True,
        "redirect_url": None,
        **extra,
    }
    response = client.post("/api/v1/settings/forms", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_トークンは発行のときだけ全文が返る(admin: TestClient) -> None:
    created = admin.post("/api/v1/settings/mcp/tokens", json={"name": "WSL の Claude Code", "client": "claude-code"})
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["secret"].startswith("wks_")
    assert body["token"]["prefix"] == body["secret"][:8]
    assert body["token"]["last_used_at"] is None
    # 一覧には全文が出ない
    listed = admin.get("/api/v1/settings/mcp/tokens").json()
    assert all("secret" not in token for token in listed)
    assert listed[0]["name"] == "WSL の Claude Code"


def test_トークンは失効させると消える(admin: TestClient) -> None:
    token = admin.post("/api/v1/settings/mcp/tokens", json={"name": "消す"}).json()["token"]
    assert admin.delete(f"/api/v1/settings/mcp/tokens/{token['id']}").status_code == 204
    assert admin.get("/api/v1/settings/mcp/tokens").json() == []
    assert admin.delete(f"/api/v1/settings/mcp/tokens/{token['id']}").status_code == 404


def test_トークンの照合は最終利用を記録する(admin: TestClient, conn: Any) -> None:
    from app.settings.service import verify_token

    secret = admin.post("/api/v1/settings/mcp/tokens", json={"name": "照合"}).json()["secret"]
    assert verify_token(conn, "wks_ちがう") is None
    found = verify_token(conn, secret)
    assert found is not None
    assert admin.get("/api/v1/settings/mcp/tokens").json()[0]["last_used_at"] is not None


def test_管理者でなければ環境設定を触れない(member: TestClient) -> None:
    assert member.get("/api/v1/settings/mcp/tokens").status_code == 403
    assert member.get("/api/v1/settings/forms").status_code == 403
    assert (
        member.post("/api/v1/settings/forms", json={"name": "x", "object": "contacts", "fields": ["name"]}).status_code
        == 403
    )


def test_受け付けられない項目は_400(admin: TestClient) -> None:
    for fields in (["created_at"], ["related"], []):
        response = admin.post("/api/v1/settings/forms", json={"name": "だめ", "object": "tasks", "fields": fields})
        assert response.status_code == 400


def test_戻り先の_URL_は_http_で始める(admin: TestClient) -> None:
    response = admin.post(
        "/api/v1/settings/forms",
        json={"name": "だめ", "object": "contacts", "fields": ["name"], "redirect_url": "javascript:alert(1)"},
    )
    assert response.status_code == 400


def test_受け口は認証なしで受けてレコードを作る(admin: TestClient, client: TestClient) -> None:
    form = make_form(admin)
    admin.delete("/api/v1/session")  # ログアウトしても受け口は通る
    response = client.post(
        f"/api/v1/forms/{form['key']}",
        data={"name": "問い合わせ太郎", "email": "taro@example.jp", "description": "資料がほしい"},
    )
    assert response.status_code == 200, response.text
    record = response.json()["record"]
    assert record["name"] == "問い合わせ太郎"
    # defaults が足される
    assert record["status"] == "new"


def test_fields_に無い列は捨てる(admin: TestClient) -> None:
    form = make_form(admin)
    response = admin.post(f"/api/v1/forms/{form['key']}", data={"name": "太郎", "department": "勝手に入れた"})
    assert response.status_code == 200
    assert response.json()["record"]["department"] is None


def test_文字は項目の型に直してから検証する(admin: TestClient, make: Make) -> None:
    account = make("accounts", name="フォームの取引先")
    form = make_form(
        admin,
        object="opportunities",
        fields=["name", "amount", "close_date"],
        # 必須の参照は、受け付ける項目でなく既定値で入れる
        defaults={"account_id": account},
    )
    response = admin.post(
        f"/api/v1/forms/{form['key']}", data={"name": "引き合い", "amount": "1,200,000", "close_date": "2026/10/3"}
    )
    assert response.status_code == 200, response.text
    record = response.json()["record"]
    assert record["amount"] == 1200000
    assert record["close_date"] == "2026-10-03"
    # 直せない値は 400
    assert admin.post(f"/api/v1/forms/{form['key']}", data={"name": "だめ", "amount": "たくさん"}).status_code == 400


def test_bot_避けの隠し欄が埋まっていたら何もしない(admin: TestClient) -> None:
    form = make_form(admin)
    before = admin.post("/api/v1/objects/contacts/records/query", json={}).json()["total"]
    response = admin.post(f"/api/v1/forms/{form['key']}", data={"name": "bot", "_gotcha": "罠"})
    # 成功に見せる(弾かれたと気づかせない)
    assert response.status_code == 200
    assert response.json()["record"]["id"]
    assert admin.post("/api/v1/objects/contacts/records/query", json={}).json()["total"] == before
    assert admin.get("/api/v1/settings/forms").json()[0]["submissions"] == 0


def test_送信の回数と最終送信を数える(admin: TestClient) -> None:
    form = make_form(admin)
    for i in range(3):
        admin.post(f"/api/v1/forms/{form['key']}", data={"name": f"太郎{i}"})
    listed = admin.get("/api/v1/settings/forms").json()[0]
    assert listed["submissions"] == 3
    assert listed["last_submitted_at"] is not None


def test_間引き(admin: TestClient) -> None:
    form = make_form(admin)
    codes = [admin.post(f"/api/v1/forms/{form['key']}", data={"name": f"太郎{i}"}).status_code for i in range(12)]
    assert codes.count(200) == 10
    assert codes.count(429) == 2


def test_止めたフォームと知らない鍵は_404(admin: TestClient) -> None:
    form = make_form(admin, enabled=False)
    assert admin.post(f"/api/v1/forms/{form['key']}", data={"name": "太郎"}).status_code == 404
    assert admin.post("/api/v1/forms/しらない", data={"name": "太郎"}).status_code == 404


def test_鍵を作り直すと古い_URL_は_404(admin: TestClient) -> None:
    form = make_form(admin)
    old_key = form["key"]
    rotated = admin.post(f"/api/v1/settings/forms/{form['id']}/rotate").json()
    assert rotated["key"] != old_key
    assert admin.post(f"/api/v1/forms/{old_key}", data={"name": "太郎"}).status_code == 404
    assert admin.post(f"/api/v1/forms/{rotated['key']}", data={"name": "太郎"}).status_code == 200


def test_先のテーブルが削除中なら受けない(admin: TestClient, conn: Any) -> None:
    from sqlalchemy import text

    form = make_form(admin)
    conn.execute(text("update meta_objects set deleted_at = now() where key = 'contacts'"))
    assert admin.post(f"/api/v1/forms/{form['key']}", data={"name": "太郎"}).status_code == 404


def test_HTML_のフォームからは_303_か受付の画面(admin: TestClient) -> None:
    form = make_form(admin, redirect_url="https://example.jp/thanks")
    response = admin.post(
        f"/api/v1/forms/{form['key']}",
        data={"name": "太郎"},
        headers={"accept": "text/html"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert response.headers["location"] == "https://example.jp/thanks"

    plain = make_form(admin, name="戻り先なし")
    page = admin.post(f"/api/v1/forms/{plain['key']}", data={"name": "太郎"}, headers={"accept": "text/html"})
    assert page.status_code == 200
    assert "送信しました" in page.text


def test_JSON_でも受ける(admin: TestClient) -> None:
    form = make_form(admin)
    response = admin.post(f"/api/v1/forms/{form['key']}", json={"name": "JSON 太郎"})
    assert response.status_code == 200
    assert response.json()["record"]["name"] == "JSON 太郎"
