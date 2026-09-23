"""ログインと、ログインしていないときの 401(04 §1・§2)。"""

from fastapi.testclient import TestClient

from tests.conftest import ADMIN_EMAIL


def test_未ログインの_session_は_401_で_code_と_message_を返す(client: TestClient) -> None:
    response = client.get("/api/v1/session")
    assert response.status_code == 401
    assert response.json() == {"code": "unauthorized", "message": "ログインしていません"}


def test_ログインすると利用者とワークスペースが返り_続く読み取りが通る(client: TestClient) -> None:
    response = client.post("/api/v1/session", json={"email": ADMIN_EMAIL, "password": "なんでも"})
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["email"] == ADMIN_EMAIL
    assert body["user"]["admin"] is True
    assert body["workspace"]["timezone"] == "Asia/Tokyo"
    assert client.get("/api/v1/session").status_code == 200


def test_いない利用者では_401(client: TestClient) -> None:
    response = client.post("/api/v1/session", json={"email": "nobody@example.jp", "password": "x"})
    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


def test_ログアウトすると_401_に戻る(admin: TestClient) -> None:
    assert admin.delete("/api/v1/session").status_code == 204
    assert admin.get("/api/v1/session").status_code == 401


def test_書き換えた_cookie_では通らない(client: TestClient) -> None:
    client.cookies.set("works_session", "09000000-0000-7000-8000-000000000001.deadbeef")
    assert client.get("/api/v1/session").status_code == 401


def test_管理者でない利用者には_admin_が付かない(member: TestClient) -> None:
    assert "admin" not in member.get("/api/v1/session").json()["user"]
