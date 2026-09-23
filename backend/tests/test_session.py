"""ログインと、ログインしていないときの 401(04 §1・§2)。

前半は `WORKS_AUTH=dev`(メールアドレスだけ。手元とテスト)、後半は本番の Cloudflare Access の JWT。
"""

import time
from collections.abc import Iterator

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from httpx2 import Response

from app import access
from app.config import get_settings
from app.security import sign
from tests.conftest import ADMIN_EMAIL, MEMBER_EMAIL


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


# --- 本番のログイン: Cloudflare Access の JWT(03 §5 の B 案)-----------------------------

TEAM = "https://works-test.cloudflareaccess.com"
AUD = "aud-tag-for-works"
_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _token(key: rsa.RSAPrivateKey = _KEY, **overrides: object) -> str:
    now = int(time.time())
    claims: dict[str, object] = {
        "aud": [AUD],
        "email": ADMIN_EMAIL,
        "iss": TEAM,
        "iat": now,
        "exp": now + 3600,
        "sub": "00000000-0000-0000-0000-000000000000",
    }
    claims.update(overrides)
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, key, algorithm="RS256")


@pytest.fixture
def via_access(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """WORKS_AUTH=access のクライアント。公開鍵は外へ取りに行かず、テストの鍵を返す。"""
    monkeypatch.setenv("WORKS_AUTH", "access")
    monkeypatch.setenv("WORKS_ACCESS_TEAM_DOMAIN", TEAM + "/")
    monkeypatch.setenv("WORKS_ACCESS_AUD", AUD)
    monkeypatch.setattr(access, "signing_key", lambda _token: _KEY.public_key())
    get_settings.cache_clear()
    yield client
    monkeypatch.undo()
    get_settings.cache_clear()


def _get(client: TestClient, token: str | None) -> Response:
    headers = {} if token is None else {"Cf-Access-Jwt-Assertion": token}
    return client.get("/api/v1/session", headers=headers)


def test_Access_の_JWT_のメールアドレスで利用者が決まる(via_access: TestClient) -> None:
    response = _get(via_access, _token(email=ADMIN_EMAIL.upper()))
    assert response.status_code == 200
    assert response.json()["user"]["email"] == ADMIN_EMAIL
    assert response.json()["user"]["admin"] is True
    assert _get(via_access, _token(email=MEMBER_EMAIL)).json()["user"]["email"] == MEMBER_EMAIL


def test_Access_を通っていなければ_401(via_access: TestClient) -> None:
    response = _get(via_access, None)
    assert response.status_code == 401
    assert response.json()["code"] == "access_required"


@pytest.mark.parametrize(
    "token",
    [
        pytest.param(_token(_OTHER_KEY), id="別の鍵で署名"),
        pytest.param(_token(aud=["another-app"]), id="別のアプリ宛て"),
        pytest.param(_token(iss="https://evil.cloudflareaccess.com"), id="別のチームが発行"),
        pytest.param(_token(exp=int(time.time()) - 3600), id="期限切れ"),
        pytest.param(_token(exp=None), id="期限が無い"),
        pytest.param(_token(email=None, common_name="service-token.access"), id="サービストークン"),
        pytest.param("not-a-jwt", id="壊れた値"),
    ],
)
def test_確かめられない_JWT_では_401(via_access: TestClient, token: str) -> None:
    response = _get(via_access, token)
    assert response.status_code == 401
    assert response.json()["code"] == "access_required"


def test_署名の無い_JWT_は受けない(via_access: TestClient) -> None:
    unsigned = jwt.encode({"aud": [AUD], "email": ADMIN_EMAIL, "iss": TEAM}, "", algorithm="none")
    assert _get(via_access, unsigned).status_code == 401


def test_登録されていないメールアドレスは_403(via_access: TestClient) -> None:
    response = _get(via_access, _token(email="stranger@example.jp"))
    assert response.status_code == 403
    assert response.json()["code"] == "not_registered"


def test_Cookie_だけでは通らない(via_access: TestClient) -> None:
    """dev の Cookie を持っていても、access では JWT しか見ない。"""
    via_access.cookies.set("works_session", sign("09000000-0000-7000-8000-000000000001"))
    assert _get(via_access, None).status_code == 401


def test_access_では_POST_session_で入れない(via_access: TestClient) -> None:
    response = via_access.post("/api/v1/session", json={"email": ADMIN_EMAIL, "password": "x"})
    assert response.status_code == 400
    assert response.json()["code"] == "access_login"


def test_access_のログアウトは_Access_のログアウトへ送る(via_access: TestClient) -> None:
    response = via_access.delete("/api/v1/session")
    assert response.status_code == 200
    assert response.json() == {"logout_url": "/cdn-cgi/access/logout"}


def test_Access_の設定が無ければ_503(via_access: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WORKS_ACCESS_AUD", "")
    get_settings.cache_clear()
    response = _get(via_access, _token())
    assert response.status_code == 503
    assert response.json()["code"] == "auth_not_configured"


def test_読み書きの_API_も_JWT_で通る(via_access: TestClient) -> None:
    headers = {"Cf-Access-Jwt-Assertion": _token()}
    assert via_access.get("/api/v1/meta", headers=headers).status_code == 200
    assert via_access.get("/api/v1/meta").status_code == 401
