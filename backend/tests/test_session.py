"""ログインと、ログインしていないときの 401(03 §5、04 §16)。アプリ自身のログイン(パスワード → TOTP の 6 桁)。"""

import time
from datetime import UTC, datetime, timedelta

import pyotp
import pytest
from fastapi.testclient import TestClient
from httpx2 import Response
from sqlalchemy import Connection, func, insert, select, update

from app.auth import passwords, sessions, throttle, totp
from app.config import get_settings
from app.meta.tables import login_attempts, login_challenges, user_sessions, users
from tests.conftest import ADMIN_EMAIL, ADMIN_ID, MEMBER_EMAIL, MEMBER_ID, login_as

PASSWORD = "correct horse battery staple"
SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"


@pytest.fixture
def with_password(conn: Connection) -> None:
    """管理者はパスワードと 2 段階認証を設定済み、もう 1 人はパスワードだけ(初めてのログインで設定する)。"""
    hashed = passwords.hash_password(PASSWORD)
    conn.execute(
        update(users)
        .where(users.c.id == ADMIN_ID)
        .values(password_hash=hashed, totp_secret=totp.encrypt(SECRET), totp_enabled_at=func.now())
    )
    conn.execute(update(users).where(users.c.id == MEMBER_ID).values(password_hash=hashed))


def code(secret: str = SECRET, *, offset: int = 0) -> str:
    return pyotp.TOTP(secret).at(int(time.time()) + offset * totp.PERIOD)


def first_step(client: TestClient, email: str = ADMIN_EMAIL, password: str = PASSWORD) -> Response:
    return client.post("/api/v1/session", json={"email": email, "password": password})


def log_in(client: TestClient) -> Response:
    assert first_step(client).json() == {"status": "totp"}
    return client.post("/api/v1/session/totp", json={"code": code()})


def failures(
    conn: Connection, user_id: str | None, count: int, *, reason: str = "bad_password", ip: str = "198.51.100.7"
) -> None:
    """失敗の記録を直に積む(照らす時間を掛けずに、待ちの境目を確かめるため)。"""
    for _ in range(count):
        conn.execute(
            insert(login_attempts).values(
                email="x", user_id=user_id, method="password", ip=ip, succeeded=False, reason=reason
            )
        )


# --- アプリ自身のログイン -----------------------------------------------------------------------


def test_未ログインの_session_は_401_で_code_と_message_を返す(client: TestClient) -> None:
    response = client.get("/api/v1/session")
    assert response.status_code == 401
    assert response.json() == {"code": "unauthenticated", "message": "ログインしてください"}


def test_パスワードと_6_桁で入ると利用者とワークスペースが返り_続く読み取りが通る(
    client: TestClient, with_password: None
) -> None:
    response = first_step(client)
    assert response.status_code == 200
    assert response.json() == {"status": "totp"}
    # 2 段目が通るまではセッションが無い
    assert client.get("/api/v1/session").status_code == 401

    response = client.post("/api/v1/session/totp", json={"code": code()})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["user"]["email"] == ADMIN_EMAIL
    assert body["user"]["admin"] is True
    assert body["workspace"]["timezone"] == "Asia/Tokyo"
    assert client.get("/api/v1/session").status_code == 200


def test_セッションの_Cookie_は_HttpOnly_で_Lax(client: TestClient, with_password: None) -> None:
    first_step(client)
    response = client.post("/api/v1/session/totp", json={"code": code()})
    cookie = [c for c in response.headers.get_list("set-cookie") if c.startswith(sessions.session_cookie() + "=")][0]
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Path=/" in cookie


def test_メールアドレスは大文字でも通り_全角の_6_桁も受ける(client: TestClient, with_password: None) -> None:
    assert first_step(client, email=" Takuya@Example.JP ").json() == {"status": "totp"}
    wide = code().translate(str.maketrans("0123456789", "０１２３４５６７８９"))
    assert client.post("/api/v1/session/totp", json={"code": wide}).status_code == 200


def test_違うパスワードと_いない利用者は_同じ_401(client: TestClient, with_password: None) -> None:
    wrong = first_step(client, password="wrong password here")
    nobody = first_step(client, email="nobody@example.jp")
    assert wrong.status_code == nobody.status_code == 401
    assert (
        wrong.json()
        == nobody.json()
        == {"code": "invalid_credentials", "message": "メールアドレスかパスワードが違います"}
    )


def test_パスワードを持たない人は_パスワードでは入れない(client: TestClient) -> None:
    response = first_step(client)
    assert response.status_code == 401
    assert response.json()["code"] == "invalid_credentials"


def test_失敗は記録に残る(client: TestClient, conn: Connection, with_password: None) -> None:
    first_step(client, password="wrong password here")
    first_step(client, email="nobody@example.jp")
    rows = conn.execute(
        select(login_attempts.c.email, login_attempts.c.reason).order_by(login_attempts.c.created_at)
    ).all()
    assert [tuple(r) for r in rows] == [(ADMIN_EMAIL, "bad_password"), ("nobody@example.jp", "no_user")]


def test_6_桁が違えば_400_で_5_回違えると札が消える(client: TestClient, conn: Connection, with_password: None) -> None:
    first_step(client)
    for _ in range(4):
        response = client.post("/api/v1/session/totp", json={"code": "000000"})
        assert response.status_code == 400
        assert response.json()["code"] == "invalid_code"
    response = client.post("/api/v1/session/totp", json={"code": "000000"})
    assert response.status_code == 401
    assert response.json()["code"] == "login_expired"
    assert conn.execute(select(func.count()).select_from(login_challenges)).scalar_one() == 0
    # 札が無くなったので、正しい 6 桁でも入れない(パスワードからやり直す)
    assert client.post("/api/v1/session/totp", json={"code": code()}).json()["code"] == "login_expired"


def test_札が無ければ_6_桁だけでは入れない(client: TestClient, with_password: None) -> None:
    response = client.post("/api/v1/session/totp", json={"code": code()})
    assert response.status_code == 401
    assert response.json()["code"] == "login_expired"


def test_切れた札では入れない(client: TestClient, conn: Connection, with_password: None) -> None:
    first_step(client)
    conn.execute(update(login_challenges).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    assert client.post("/api/v1/session/totp", json={"code": code()}).json()["code"] == "login_expired"


def test_同じ_6_桁は_2_度通らない(client: TestClient, with_password: None) -> None:
    used = code()
    first_step(client)
    assert client.post("/api/v1/session/totp", json={"code": used}).status_code == 200
    client.delete("/api/v1/session")
    first_step(client)
    response = client.post("/api/v1/session/totp", json={"code": used})
    assert response.status_code == 400
    # 次の刻みのコードなら通る(前後 1 刻みまで受ける)
    assert client.post("/api/v1/session/totp", json={"code": code(offset=1)}).status_code == 200


def test_2_段階認証がまだの人は_設定してから入る(client: TestClient, conn: Connection, with_password: None) -> None:
    response = first_step(client, email=MEMBER_EMAIL)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "totp_setup"
    setup = body["setup"]
    assert len(setup["secret"]) == 32
    assert setup["otpauth_uri"].startswith("otpauth://totp/")
    assert "misaki%40example.jp" in setup["otpauth_uri"]
    assert setup["qr_svg"].startswith("data:image/svg+xml")
    # 設定が済むまでセッションは作らず、秘密も「設定中」のまま
    assert client.get("/api/v1/session").status_code == 401
    assert conn.execute(select(users.c.totp_secret).where(users.c.id == MEMBER_ID)).scalar_one() is None

    response = client.post("/api/v1/session/totp", json={"code": code(setup["secret"])})
    assert response.status_code == 200, response.text
    row = conn.execute(select(users).where(users.c.id == MEMBER_ID)).one()
    assert totp.decrypt(row.totp_secret) == setup["secret"]
    assert row.totp_pending_secret is None
    assert row.totp_enabled_at is not None
    # 次からは 6 桁を求められる
    client.delete("/api/v1/session")
    assert first_step(client, email=MEMBER_EMAIL).json() == {"status": "totp"}


def test_鍵が変わって秘密を読めなければ_設定し直しになる(
    client: TestClient, conn: Connection, with_password: None
) -> None:
    conn.execute(update(users).where(users.c.id == ADMIN_ID).values(totp_secret="読めない値"))
    assert first_step(client).json()["status"] == "totp_setup"


def test_ログインが通れば記録され_最後のログイン時刻が付く(
    client: TestClient, conn: Connection, with_password: None
) -> None:
    log_in(client)
    assert conn.execute(select(users.c.last_login_at).where(users.c.id == ADMIN_ID)).scalar_one() is not None
    rows = conn.execute(select(login_attempts.c.succeeded, login_attempts.c.method)).all()
    assert [tuple(r) for r in rows] == [(True, "password")]


def test_5_回続けて失敗すると待たされ_待つ間は照らさない(
    client: TestClient, conn: Connection, with_password: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    for _ in range(throttle.FREE_FAILURES):
        assert first_step(client, password="wrong password here").status_code == 401
    # 正しいパスワードでも、待ちが明けるまでは受けない(照らしもしない)
    monkeypatch.setattr(passwords, "verify", lambda *_: pytest.fail("待たせている間は照らさない"))
    response = first_step(client)
    assert response.status_code == 429
    assert response.json()["code"] == "too_many_attempts"
    assert 0 < int(response.headers["retry-after"]) <= 60
    assert "1 分" in response.json()["message"]


def test_待ちは倍々に伸び_1_時間で止まる(conn: Connection) -> None:
    failures(conn, ADMIN_ID, 6)
    wait = throttle.check(conn, user_id=ADMIN_ID, ip=None)
    assert wait is not None and 60 < (wait.retry_after or 0) <= 120
    failures(conn, ADMIN_ID, 20)
    wait = throttle.check(conn, user_id=ADMIN_ID, ip=None)
    assert wait is not None and 3000 < (wait.retry_after or 0) <= 3601


def test_待ちが明ければまた試せ_通れば数え直す(client: TestClient, conn: Connection, with_password: None) -> None:
    failures(conn, ADMIN_ID, throttle.FREE_FAILURES)
    conn.execute(update(login_attempts).values(created_at=datetime.now(UTC) - timedelta(minutes=2)))
    log_in(client)
    assert throttle.check(conn, user_id=ADMIN_ID, ip=None) is None


def test_100_回続けて失敗すると_パスワードでのログインを止め_決め直すと戻る(
    client: TestClient, conn: Connection, with_password: None
) -> None:
    failures(conn, ADMIN_ID, throttle.LOCK_FAILURES)
    conn.execute(update(login_attempts).values(created_at=datetime.now(UTC) - timedelta(days=1)))
    response = first_step(client)
    assert response.status_code == 429
    assert "retry-after" not in response.headers
    assert "止めています" in response.json()["message"]
    # 管理者が set-password で決め直した(= password_changed_at が新しい)なら、数え直す
    conn.execute(update(users).where(users.c.id == ADMIN_ID).values(password_changed_at=func.clock_timestamp()))
    assert first_step(client).json() == {"status": "totp"}


def test_同じ_IP_から_10_分に_30_回失敗すると_ほかの人も受けない(
    client: TestClient, conn: Connection, with_password: None
) -> None:
    ip = "198.51.100.7"
    failures(conn, None, throttle.IP_FAILURES, reason="no_user", ip=ip)
    response = client.post(
        "/api/v1/session", json={"email": MEMBER_EMAIL, "password": PASSWORD}, headers={"cf-connecting-ip": ip}
    )
    assert response.status_code == 429
    # ほかの場所からは受ける
    other = client.post(
        "/api/v1/session",
        json={"email": MEMBER_EMAIL, "password": PASSWORD},
        headers={"cf-connecting-ip": "203.0.113.9"},
    )
    assert other.status_code == 200


def test_待たせて断った試みは_同じ送り元から_1_分に_1_件だけ残す(
    client: TestClient, conn: Connection, with_password: None
) -> None:
    ip = "198.51.100.7"
    failures(conn, None, throttle.IP_FAILURES, reason="no_user", ip=ip)
    for _ in range(5):
        response = client.post(
            "/api/v1/session", json={"email": MEMBER_EMAIL, "password": PASSWORD}, headers={"cf-connecting-ip": ip}
        )
        assert response.status_code == 429

    def throttled(where_ip: str) -> int:
        return conn.execute(
            select(func.count()).where(login_attempts.c.reason == "throttled", login_attempts.c.ip == where_ip)
        ).scalar_one()

    assert throttled(ip) == 1
    # 1 分経てば、また 1 件残す
    conn.execute(
        update(login_attempts)
        .where(login_attempts.c.reason == "throttled")
        .values(created_at=datetime.now(UTC) - timedelta(minutes=2))
    )
    client.post("/api/v1/session", json={"email": MEMBER_EMAIL, "password": PASSWORD}, headers={"cf-connecting-ip": ip})
    assert throttled(ip) == 2


@pytest.mark.parametrize("origin", [None, "https://evil.example"], ids=["Origin が無い", "よそのサイト"])
def test_よそのサイトからのログインと書き込みは_403(
    client: TestClient, with_password: None, origin: str | None
) -> None:
    headers = {"origin": origin} if origin else {}
    if origin is None:
        del client.headers["origin"]
    response = client.post("/api/v1/session", json={"email": ADMIN_EMAIL, "password": PASSWORD}, headers=headers)
    assert response.status_code == 403
    assert response.json()["code"] == "bad_origin"
    login_as(client, ADMIN_ID)
    assert client.post("/api/v1/meta/views", json={}, headers=headers).status_code == 403
    # 読むだけなら Origin は見ない
    assert client.get("/api/v1/session", headers=headers).status_code == 200


def test_ログアウトすると_401_に戻り_セッションの行も消える(admin: TestClient, conn: Connection) -> None:
    assert admin.delete("/api/v1/session").status_code == 204
    assert admin.get("/api/v1/session").status_code == 401
    assert conn.execute(select(func.count()).select_from(user_sessions)).scalar_one() == 0


def test_書き換えた_cookie_では通らない(client: TestClient) -> None:
    client.cookies.set(sessions.session_cookie(), "forged-token-value")
    assert client.get("/api/v1/session").status_code == 401


def test_期限が切れたセッションでは通らない(admin: TestClient, conn: Connection) -> None:
    conn.execute(update(user_sessions).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    assert admin.get("/api/v1/session").status_code == 401


def test_消した利用者のセッションは効かない(admin: TestClient, conn: Connection) -> None:
    conn.execute(update(users).where(users.c.id == ADMIN_ID).values(deleted_at=func.now()))
    assert admin.get("/api/v1/session").status_code == 401


def test_管理者でない利用者には_admin_が付かない(member: TestClient) -> None:
    assert "admin" not in member.get("/api/v1/session").json()["user"]


def test_ログインの画面が出すもの(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Google・Microsoft の設定が無ければ、どちらのボタンも出さない(設定があるときは test_oidc.py)。"""
    for name in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "MICROSOFT_CLIENT_ID", "MICROSOFT_CERTIFICATE"):
        monkeypatch.setenv(f"WORKS_{name}", "")
    get_settings.cache_clear()
    try:
        assert client.get("/api/v1/session/options").json() == {"google": False, "microsoft": False}
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()
