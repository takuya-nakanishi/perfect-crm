"""アカウント(04 §16、05 §15): パスワードを変える、2 段階認証をやり直す、ログイン中の端末を切る。"""

import time
from datetime import UTC, datetime, timedelta

import pyotp
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Connection, func, select, update

from app.auth import passwords, totp
from app.meta.tables import login_attempts, oauth_clients, oauth_grants, user_sessions, users
from tests.conftest import ADMIN_ID, MEMBER_ID, login_as

PASSWORD = "correct horse battery staple"
NEW_PASSWORD = "a brand new passphrase 2026"
LONG_AGO = datetime.now(UTC) - timedelta(hours=2)


@pytest.fixture
def with_password(conn: Connection) -> None:
    conn.execute(update(users).where(users.c.id == ADMIN_ID).values(password_hash=passwords.hash_password(PASSWORD)))


def test_アカウントの状態を返す(admin: TestClient, conn: Connection) -> None:
    body = admin.get("/api/v1/account").json()
    assert body == {
        "has_password": False,
        "password_changed_at": None,
        "totp_enabled_at": None,
        "google_email": None,
        "microsoft_email": None,
        "recent_login": True,
    }
    conn.execute(update(user_sessions).values(created_at=LONG_AGO))
    assert admin.get("/api/v1/account").json()["recent_login"] is False


def test_さっきログインしたなら_いまのパスワード無しで変えられ_ほかは切れる(
    client: TestClient, conn: Connection, with_password: None
) -> None:
    other = login_as(TestClient(client.app), ADMIN_ID)  # 別の端末
    conn.execute(oauth_clients.insert().values(client_id="c1", info={}))
    conn.execute(oauth_grants.insert().values(client_id="c1", user_id=ADMIN_ID, scopes=["works"]))
    login_as(client, ADMIN_ID)

    response = client.put("/api/v1/account/password", json={"new_password": NEW_PASSWORD})
    assert response.status_code == 204, response.text
    row = conn.execute(select(users).where(users.c.id == ADMIN_ID)).one()
    assert passwords.verify(row.password_hash, NEW_PASSWORD)
    assert row.password_changed_at is not None
    # いまの端末は残り、ほかの端末とアプリの許可は切れる
    assert client.get("/api/v1/session").status_code == 200
    assert conn.execute(select(func.count()).select_from(user_sessions)).scalar_one() == 1
    assert conn.execute(select(func.count()).select_from(oauth_grants)).scalar_one() == 0
    del other


def test_時間が経っていれば_いまのパスワードが要り_違えば数えられる(
    admin: TestClient, conn: Connection, with_password: None
) -> None:
    conn.execute(update(user_sessions).values(created_at=LONG_AGO))
    response = admin.put("/api/v1/account/password", json={"new_password": NEW_PASSWORD})
    assert response.status_code == 400
    assert response.json()["code"] == "reauth_required"

    response = admin.put(
        "/api/v1/account/password", json={"current_password": "wrong password here", "new_password": NEW_PASSWORD}
    )
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_credentials"
    # ログインの間引きと同じ数えに入る(ここを総当たりの抜け道にしない)
    assert conn.execute(select(login_attempts.c.reason)).scalars().all() == ["bad_password"]

    response = admin.put("/api/v1/account/password", json={"current_password": PASSWORD, "new_password": NEW_PASSWORD})
    assert response.status_code == 204


def test_パスワードを持たない人は_さっきログインしていれば決められる(admin: TestClient, conn: Connection) -> None:
    assert admin.put("/api/v1/account/password", json={"new_password": NEW_PASSWORD}).status_code == 204
    assert admin.get("/api/v1/account").json()["has_password"] is True
    conn.execute(update(user_sessions).values(created_at=LONG_AGO))
    conn.execute(update(users).where(users.c.id == ADMIN_ID).values(password_hash=None))
    response = admin.put("/api/v1/account/password", json={"new_password": NEW_PASSWORD})
    assert response.json()["code"] == "reauth_required"


@pytest.mark.parametrize(
    ("password", "reason"),
    [
        ("short one", "15 文字以上"),
        ("takuya@example.jp", "同じ"),
        ("Sanei Clover", "15 文字以上"),
        ("x" * 257, "256 文字まで"),
    ],
)
def test_決まりに合わないパスワードは理由付きで断る(admin: TestClient, password: str, reason: str) -> None:
    response = admin.put("/api/v1/account/password", json={"new_password": password})
    assert response.status_code == 400
    assert response.json()["code"] == "weak_password"
    assert reason in response.json()["message"]


def test_2_段階認証をやり直すと_古い秘密は効かなくなる(admin: TestClient, conn: Connection) -> None:
    conn.execute(update(users).where(users.c.id == ADMIN_ID).values(totp_secret=totp.encrypt("A" * 32)))
    setup = admin.post("/api/v1/account/totp").json()
    assert setup["qr_svg"].startswith("data:image/svg+xml")
    assert admin.put("/api/v1/account/totp", json={"code": "000000"}).json()["code"] == "invalid_code"
    now = pyotp.TOTP(setup["secret"]).at(int(time.time()))
    assert admin.put("/api/v1/account/totp", json={"code": now}).status_code == 204
    row = conn.execute(select(users).where(users.c.id == ADMIN_ID)).one()
    assert totp.decrypt(row.totp_secret) == setup["secret"]
    assert row.totp_pending_secret is None
    assert admin.get("/api/v1/account").json()["totp_enabled_at"] is not None


def test_2_段階認証のやり直しには_さっきのログインが要る(admin: TestClient, conn: Connection) -> None:
    conn.execute(update(user_sessions).values(created_at=LONG_AGO))
    response = admin.post("/api/v1/account/totp")
    assert response.status_code == 400
    assert response.json()["code"] == "reauth_required"
    # 始めていなければ、6 桁だけでは入れ替わらない
    assert admin.put("/api/v1/account/totp", json={"code": "123456"}).json()["code"] == "totp_not_started"


def test_ログイン中の端末を一覧し_1_つずつ_まとめて切れる(client: TestClient, conn: Connection) -> None:
    login_as(TestClient(client.app), ADMIN_ID, user_agent="Mozilla/5.0 (Linux; Android 16) Chrome/140.0 Mobile")
    tablet = login_as(TestClient(client.app), ADMIN_ID)
    login_as(client, ADMIN_ID)
    listed = client.get("/api/v1/account/sessions").json()
    assert len(listed) == 3
    assert [s["current"] for s in listed].count(True) == 1
    assert {s["kind"] for s in listed} == {"browser"}
    assert "Chrome · Android" in {s["label"] for s in listed}

    others = [s["id"] for s in listed if not s["current"]]
    assert client.delete(f"/api/v1/account/sessions/{others[0]}").status_code == 204
    assert len(client.get("/api/v1/account/sessions").json()) == 2
    assert client.delete("/api/v1/account/sessions").status_code == 204
    assert [s["current"] for s in client.get("/api/v1/account/sessions").json()] == [True]
    del tablet


def test_ほかの人の端末と_ID_でないものは_404(client: TestClient) -> None:
    member = login_as(TestClient(client.app), MEMBER_ID)
    login_as(client, ADMIN_ID)
    theirs = member.get("/api/v1/account/sessions").json()[0]["id"]
    assert client.delete(f"/api/v1/account/sessions/{theirs}").status_code == 404
    assert client.delete("/api/v1/account/sessions/not-a-uuid").status_code == 404
    assert member.get("/api/v1/session").status_code == 200


def test_未ログインでは_401(client: TestClient) -> None:
    assert client.get("/api/v1/account").status_code == 401
    assert client.get("/api/v1/account/sessions").status_code == 401
