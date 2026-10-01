"""Google・Microsoft でログイン(03 §5、04 §16)。

**本物の Google・Microsoft には繋がない** — `app.auth.oidc.call` を偽物に差し替える。

偽物の提供元は、discovery document・公開鍵・トークンの口を持ち、許可の画面の URL から認可コードを出す。
ID トークンは手元の RSA の鍵で本物と同じ形に署名し、トークンの口では PKCE・戻り先・クライアントの証明
(Google は client secret、Microsoft は証明書で署名した JWT)を確かめる。表の行は AUTH-070〜(`docs/tests/auth.md` §6)。
"""

import base64
import hashlib
import json
import secrets
import time
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlparse

import jwt
import pyotp
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient
from httpx2 import Response
from sqlalchemy import Connection, func, select, update

from app.auth import oidc, totp
from app.config import get_settings
from app.main import check_settings
from app.meta.tables import login_attempts, user_sessions, users
from tests.conftest import ADMIN_EMAIL, ADMIN_ID, MEMBER_ID, login_as

GOOGLE_CLIENT = "client-id.apps.googleusercontent.com"
GOOGLE_SECRET = "client-secret"
MS_CLIENT = "00001111-aaaa-2222-bbbb-3333cccc4444"
TID = "9a1b2c3d-0000-4000-8000-00000000abcd"
OTHER_TID = "9a1b2c3d-0000-4000-8000-00000000ffff"
SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"

GOOGLE_META = {
    "issuer": "https://accounts.google.com",
    "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
    "token_endpoint": "https://oauth2.googleapis.com/token",
    "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
}
MS_DISCOVERY = "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration"
MS_META = {
    # common の discovery document は、発行元をテナントの型で載せる
    "issuer": "https://login.microsoftonline.com/{tenantid}/v2.0",
    "authorization_endpoint": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    "token_endpoint": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    "jwks_uri": "https://login.microsoftonline.com/common/discovery/v2.0/keys",
}


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _rsa() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@dataclass
class Certificate:
    """Microsoft へのクライアントの証明に使う、手元で作った証明書(Entra に上げるものの代わり)。"""

    env: str
    public: Any
    thumbprint: str


def make_certificate(*, days: int = 365, key: rsa.RSAPrivateKey | None = None) -> Certificate:
    key = key or _rsa()
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Works test")])
    now = datetime.now(UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=days))
        .sign(key, hashes.SHA256())
    )
    pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ) + cert.public_bytes(serialization.Encoding.PEM)
    return Certificate(
        env=base64.b64encode(pem).decode(), public=key.public_key(), thumbprint=_b64(cert.fingerprint(hashes.SHA256()))
    )


@pytest.fixture(scope="session")
def signing_key() -> rsa.RSAPrivateKey:
    return _rsa()


@pytest.fixture(scope="session")
def certificate() -> Certificate:
    return make_certificate()


def google_claims(**over: Any) -> dict[str, Any]:
    return {
        "iss": "https://accounts.google.com",
        "aud": GOOGLE_CLIENT,
        "sub": "google-1",
        "email": ADMIN_EMAIL,
        "email_verified": True,
        "hd": "example.jp",
        **over,
    }


def ms_claims(**over: Any) -> dict[str, Any]:
    return {
        "iss": f"https://login.microsoftonline.com/{TID}/v2.0",
        "aud": MS_CLIENT,
        "sub": "microsoft-1",
        "tid": TID,
        "email": ADMIN_EMAIL,
        "xms_edov": True,
        "preferred_username": ADMIN_EMAIL,
        **over,
    }


class FakeProvider:
    """Google と Microsoft の偽物。呼ばれた口を覚えておき、テストから見られるようにする。"""

    def __init__(self, key: rsa.RSAPrivateKey, certificate: Certificate) -> None:
        self.key = key
        self.kid = "key-1"
        self.certificate = certificate
        self.codes: dict[str, dict[str, Any]] = {}
        self.calls: list[tuple[str, str]] = []
        self.assertions: list[dict[str, Any]] = []

    def jwks(self) -> dict[str, Any]:
        jwk = jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key(), as_dict=True)
        jwk.update(kid=self.kid, use="sig", alg="RS256")
        return {"keys": [jwk]}

    def call(self, method: str, url: str, *, data: dict[str, str] | None = None) -> dict[str, Any]:
        self.calls.append((method, url))
        if method == "GET" and url == oidc.GOOGLE_DISCOVERY:
            return GOOGLE_META
        if method == "GET" and url == MS_DISCOVERY:
            return MS_META
        if method == "GET" and url in (GOOGLE_META["jwks_uri"], MS_META["jwks_uri"]):
            return self.jwks()
        if method == "POST" and url in (GOOGLE_META["token_endpoint"], MS_META["token_endpoint"]):
            return self.token(url, data or {})
        raise AssertionError(f"偽物が知らない呼び出し: {method} {url}")

    def approve(
        self,
        authorize_url: str,
        claims: dict[str, Any],
        key: rsa.RSAPrivateKey | None = None,
        kid: str | None = None,
    ) -> str:
        """許可の画面で本人が許可した、ことにして認可コードを出す。`key`・`kid` は ID トークンの署名を偽るとき。"""
        query = {k: v[0] for k, v in parse_qs(urlparse(authorize_url).query).items()}
        code = secrets.token_urlsafe(16)
        self.codes[code] = {"query": query, "claims": claims, "key": key, "kid": kid}
        return code

    def token(self, url: str, data: dict[str, str]) -> dict[str, Any]:
        entry = self.codes.pop(data.get("code", ""), None)
        if entry is None:
            raise oidc.OidcError("invalid_grant")
        query = entry["query"]
        assert data["grant_type"] == "authorization_code"
        assert data["redirect_uri"] == query["redirect_uri"]
        assert data["client_id"] == query["client_id"]
        # PKCE: verifier の sha256 が、許可の画面に渡した challenge と同じ
        assert _b64(hashlib.sha256(data["code_verifier"].encode()).digest()) == query["code_challenge"]
        if url == MS_META["token_endpoint"]:
            assert "client_secret" not in data
            assert data["client_assertion_type"] == "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
            header = jwt.get_unverified_header(data["client_assertion"])
            assert header["alg"] == "PS256"
            assert header["x5t#S256"] == self.certificate.thumbprint
            claims = jwt.decode(data["client_assertion"], self.certificate.public, algorithms=["PS256"], audience=url)
            assert claims["iss"] == claims["sub"] == MS_CLIENT
            self.assertions.append(claims)
        else:
            assert data["client_secret"] == GOOGLE_SECRET
        now = int(time.time())
        claims = {"nonce": query["nonce"], "iat": now, "exp": now + 3600, **entry["claims"]}
        headers = {"kid": entry["kid"] or self.kid}
        id_token = jwt.encode(claims, entry["key"] or self.key, algorithm="RS256", headers=headers)
        return {"access_token": "access", "token_type": "Bearer", "id_token": id_token}

    def go(
        self,
        client: TestClient,
        provider: str,
        claims: dict[str, Any],
        *,
        next: str = "/o/tasks",
        key: rsa.RSAPrivateKey | None = None,
        kid: str | None = None,
    ) -> Response:
        """画面と同じ順で入る: ボタン(リンク)→ 提供元の許可の画面 → 戻り。"""
        started = client.get(f"/api/v1/session/{provider}", params={"next": next}, follow_redirects=False)
        assert started.status_code == 303, started.text
        url = started.headers["location"]
        state = parse_qs(urlparse(url).query)["state"][0]
        code = self.approve(url, claims, key, kid)
        return client.get(
            f"/api/v1/session/{provider}/callback", params={"code": code, "state": state}, follow_redirects=False
        )

    def link(self, client: TestClient, provider: str, claims: dict[str, Any]) -> Response:
        """アカウントの画面から結ぶ: 許可の URL をもらう → 許可の画面 → 戻り。"""
        started = client.post(f"/api/v1/account/identities/{provider}")
        assert started.status_code == 200, started.text
        url = started.json()["url"]
        state = parse_qs(urlparse(url).query)["state"][0]
        code = self.approve(url, claims)
        return client.get(
            f"/api/v1/session/{provider}/callback", params={"code": code, "state": state}, follow_redirects=False
        )


def configure(monkeypatch: pytest.MonkeyPatch, certificate: Certificate, *, google: bool, microsoft: bool) -> None:
    monkeypatch.setenv("WORKS_GOOGLE_CLIENT_ID", GOOGLE_CLIENT if google else "")
    monkeypatch.setenv("WORKS_GOOGLE_CLIENT_SECRET", GOOGLE_SECRET if google else "")
    monkeypatch.setenv("WORKS_MICROSOFT_CLIENT_ID", MS_CLIENT if microsoft else "")
    monkeypatch.setenv("WORKS_MICROSOFT_CERTIFICATE", certificate.env if microsoft else "")
    monkeypatch.setenv("WORKS_MICROSOFT_TENANT", "common")
    get_settings.cache_clear()
    oidc.reset()


@pytest.fixture
def idp(
    monkeypatch: pytest.MonkeyPatch, signing_key: rsa.RSAPrivateKey, certificate: Certificate
) -> Iterator[FakeProvider]:
    fake = FakeProvider(signing_key, certificate)
    monkeypatch.setattr("app.auth.oidc.call", fake.call)
    # **署名の鍵(WORKS_SECRET_KEY)は触らない** — 途中で変えると、Cookie の状態も 2 段階認証の秘密も読めなくなる
    configure(monkeypatch, certificate, google=True, microsoft=True)
    yield fake
    monkeypatch.undo()
    get_settings.cache_clear()
    oidc.reset()


@pytest.fixture
def admin_totp(conn: Connection) -> None:
    """管理者は 2 段階認証を設定済み(Microsoft で入るときの 2 段目)。"""
    conn.execute(
        update(users).where(users.c.id == ADMIN_ID).values(totp_secret=totp.encrypt(SECRET), totp_enabled_at=func.now())
    )


def where(response: Response) -> tuple[str, dict[str, str]]:
    """303 の行き先を、道と問い合わせに分ける。"""
    assert response.status_code == 303, response.text
    url = urlparse(response.headers["location"])
    return url.path, {k: v[0] for k, v in parse_qs(url.query).items()}


def session_methods(conn: Connection) -> list[str]:
    return list(conn.execute(select(user_sessions.c.method).order_by(user_sessions.c.created_at)).scalars())


def attempts(conn: Connection) -> list[tuple[str, bool, str | None]]:
    rows = conn.execute(
        select(login_attempts.c.method, login_attempts.c.succeeded, login_attempts.c.reason).order_by(
            login_attempts.c.created_at
        )
    )
    return [(r.method, r.succeeded, r.reason) for r in rows]


# --- 設定と入口 ----------------------------------------------------------------------------------


def test_ボタンは設定のある提供元だけ(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, certificate: Certificate
) -> None:
    configure(monkeypatch, certificate, google=True, microsoft=False)
    try:
        assert client.get("/api/v1/session/options").json() == {"google": True, "microsoft": False}
        # 設定の無い口を開いた → ログインの画面へ、理由の符号を付けて戻す(戻り先は持ったまま)
        path, query = where(
            client.get("/api/v1/session/microsoft", params={"next": "/o/deals"}, follow_redirects=False)
        )
        assert (path, query) == ("/login", {"error": "microsoft_not_configured", "next": "/o/deals"})
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()
        oidc.reset()


def test_許可の画面へ送るときは_PKCE_と_nonce_を付け_状態は署名した_Cookie_に置く(
    client: TestClient, idp: FakeProvider, conn: Connection
) -> None:
    started = client.get("/api/v1/session/google", params={"next": "/o/tasks"}, follow_redirects=False)
    url = urlparse(started.headers["location"])
    query = {k: v[0] for k, v in parse_qs(url.query).items()}
    assert f"{url.scheme}://{url.netloc}{url.path}" == GOOGLE_META["authorization_endpoint"]
    assert query["client_id"] == GOOGLE_CLIENT
    assert query["scope"] == "openid email"
    assert query["response_type"] == "code"
    assert query["code_challenge_method"] == "S256"
    assert query["redirect_uri"].endswith("/api/v1/session/google/callback")
    assert len(query["state"]) >= 40 and query["nonce"]
    cookie = [c for c in started.headers.get_list("set-cookie") if c.startswith(oidc.cookie() + "=")][0]
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie and "Max-Age=600" in cookie
    # 叩かれても DB に行を作らない(だれでも届く口)
    assert conn.execute(select(func.count()).select_from(login_attempts)).scalar_one() == 0


# --- Google ----------------------------------------------------------------------------------


def test_Google_で初めて入ると_確かめられたアドレスの利用者に結ばれ_元の場所へ戻る(
    client: TestClient, idp: FakeProvider, conn: Connection
) -> None:
    path, _ = where(idp.go(client, "google", google_claims()))
    assert path == "/o/tasks"
    assert client.get("/api/v1/session").json()["user"]["email"] == ADMIN_EMAIL
    row = conn.execute(select(users.c.google_sub, users.c.google_email).where(users.c.id == ADMIN_ID)).one()
    assert (row.google_sub, row.google_email) == ("google-1", ADMIN_EMAIL)
    assert session_methods(conn) == ["google"]
    assert attempts(conn) == [("google", True, None)]


def test_Google_は結んだ_sub_で引くので_アドレスが変わっても入れる(
    client: TestClient, idp: FakeProvider, conn: Connection
) -> None:
    where(idp.go(client, "google", google_claims()))
    client.cookies.clear()
    path, _ = where(idp.go(client, "google", google_claims(email="renamed@example.jp")))
    assert path == "/o/tasks"
    assert client.get("/api/v1/session").json()["user"]["id"] == ADMIN_ID
    # 表示用のアドレスは今のものに替わる
    assert conn.execute(select(users.c.google_email).where(users.c.id == ADMIN_ID)).scalar_one() == "renamed@example.jp"


@pytest.mark.parametrize(
    "claims",
    [
        google_claims(email="nobody@example.jp"),
        # Google が持ち主と言えないアドレス(確かめていない・Gmail でも Workspace でもない)では、利用者を探さない
        google_claims(email_verified=False),
        google_claims(hd=None),
    ],
    ids=["登録の無いアドレス", "確かめていない", "Gmail でも Workspace でもない"],
)
def test_Google_で登録の無い人は入れない(
    client: TestClient, idp: FakeProvider, conn: Connection, claims: dict[str, Any]
) -> None:
    path, query = where(idp.go(client, "google", {k: v for k, v in claims.items() if v is not None}))
    assert (path, query) == ("/login", {"error": "google_not_registered", "next": "/o/tasks"})
    assert client.get("/api/v1/session").status_code == 401
    assert conn.execute(select(users.c.google_sub).where(users.c.id == ADMIN_ID)).scalar_one() is None
    assert attempts(conn) == [("google", False, "not_registered")]


def test_Gmail_のアドレスは_hd_が無くても信じる(client: TestClient, idp: FakeProvider, conn: Connection) -> None:
    conn.execute(update(users).where(users.c.id == MEMBER_ID).values(email="misaki.works@gmail.com"))
    where(idp.go(client, "google", google_claims(sub="google-2", email="misaki.works@gmail.com", hd=None)))
    assert client.get("/api/v1/session").json()["user"]["id"] == MEMBER_ID


def test_消した利用者に結ばれた_Google_では入れない(client: TestClient, idp: FakeProvider, conn: Connection) -> None:
    conn.execute(update(users).where(users.c.id == ADMIN_ID).values(google_sub="google-1", deleted_at=func.now()))
    path, query = where(idp.go(client, "google", google_claims()))
    assert query["error"] == "google_not_registered"


def test_戻りの_state_が_Cookie_と違えば_提供元へ問い合わせずに断る(client: TestClient, idp: FakeProvider) -> None:
    started = client.get("/api/v1/session/google", follow_redirects=False)
    code = idp.approve(started.headers["location"], google_claims())
    forged = client.get(
        "/api/v1/session/google/callback", params={"code": code, "state": "forged"}, follow_redirects=False
    )
    assert where(forged) == ("/login", {"error": "google_failed", "next": "/"})
    # Cookie が無い(別のブラウザで踏まされた)
    client.cookies.clear()
    state = parse_qs(urlparse(started.headers["location"]).query)["state"][0]
    stray = client.get("/api/v1/session/google/callback", params={"code": code, "state": state}, follow_redirects=False)
    assert where(stray)[1]["error"] == "google_failed"
    assert not [c for c in idp.calls if c[0] == "POST"]
    assert client.get("/api/v1/session").status_code == 401


def test_許可の画面で断ると_denied(client: TestClient, idp: FakeProvider) -> None:
    started = client.get("/api/v1/session/google", params={"next": "/o/deals"}, follow_redirects=False)
    state = parse_qs(urlparse(started.headers["location"]).query)["state"][0]
    back = client.get(
        "/api/v1/session/google/callback", params={"error": "access_denied", "state": state}, follow_redirects=False
    )
    assert where(back) == ("/login", {"error": "google_denied", "next": "/o/deals"})


@pytest.mark.parametrize(
    "case",
    ["署名", "発行元", "宛先", "期限", "nonce", "公開鍵"],
)
def test_ID_トークンが確かめられなければ入れない(client: TestClient, idp: FakeProvider, case: str) -> None:
    claims = google_claims()
    key, kid = None, None
    now = int(time.time())
    if case == "署名":
        key = _rsa()
    elif case == "発行元":
        claims["iss"] = "https://accounts.example.com"
    elif case == "宛先":
        claims["aud"] = "someone-else.apps.googleusercontent.com"
    elif case == "期限":
        claims.update(iat=now - 7200, exp=now - 3600)
    elif case == "nonce":
        claims["nonce"] = "replayed"
    else:
        # 公開鍵の一覧に無い kid(読み直すのは 1 分に 1 回までなので、読んだばかりの一覧で断る)
        kid = "unknown"
    response = idp.go(client, "google", claims, key=key, kid=kid)
    assert where(response)[1]["error"] == "google_failed"
    assert client.get("/api/v1/session").status_code == 401


def test_公開鍵が入れ替わったら読み直す(
    client: TestClient, idp: FakeProvider, monkeypatch: pytest.MonkeyPatch, signing_key: rsa.RSAPrivateKey
) -> None:
    where(idp.go(client, "google", google_claims()))
    client.cookies.clear()
    monkeypatch.setattr(oidc, "KEYS_RETRY", 0.0)
    idp.key, idp.kid = _rsa(), "key-2"
    path, _ = where(idp.go(client, "google", google_claims()))
    assert path == "/o/tasks"
    # discovery document は持っている。公開鍵は入れ替えのときだけ読み直した
    assert idp.calls.count(("GET", oidc.GOOGLE_DISCOVERY)) == 1
    assert idp.calls.count(("GET", GOOGLE_META["jwks_uri"])) == 2


@pytest.mark.parametrize("next_path", ["https://evil.example/", "//evil.example/", "/\\evil.example", "o/tasks"])
def test_戻り先は同じオリジンの中だけ(client: TestClient, idp: FakeProvider, next_path: str) -> None:
    path, _ = where(idp.go(client, "google", google_claims(), next=next_path))
    assert path == "/"


def test_コードの引き換えは_送り元ごとに_1_分に上限まで(
    client: TestClient, idp: FakeProvider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(oidc, "EXCHANGE_LIMIT", 2)
    for _ in range(2):
        assert where(idp.go(client, "google", google_claims(email="nobody@example.jp")))[1]["error"] == (
            "google_not_registered"
        )
    assert where(idp.go(client, "google", google_claims()))[1]["error"] == "google_busy"
    # ほかの送り元(Cloudflare が付ける IP)は受ける
    client.headers["cf-connecting-ip"] = "203.0.113.9"
    assert where(idp.go(client, "google", google_claims()))[0] == "/o/tasks"


# --- Microsoft -------------------------------------------------------------------------------


def test_Microsoft_で入ると_6_桁の段へ進み_通るとセッションができる(
    client: TestClient, idp: FakeProvider, conn: Connection, admin_totp: None
) -> None:
    path, query = where(idp.go(client, "microsoft", ms_claims()))
    assert (path, query) == ("/login", {"continue": "microsoft", "next": "/o/tasks"})
    # 6 桁が通るまでセッションは無い
    assert client.get("/api/v1/session").status_code == 401
    assert client.get("/api/v1/session/challenge").json() == {"status": "totp"}
    done = client.post("/api/v1/session/totp", json={"code": pyotp.TOTP(SECRET).now()})
    assert done.status_code == 200, done.text
    assert done.json()["user"]["id"] == ADMIN_ID
    assert session_methods(conn) == ["microsoft"]
    assert attempts(conn) == [("microsoft", True, None)]
    row = conn.execute(select(users.c.microsoft_sub, users.c.microsoft_email).where(users.c.id == ADMIN_ID)).one()
    assert (row.microsoft_sub, row.microsoft_email) == ("microsoft-1", ADMIN_EMAIL)
    # クライアントの証明は、証明書で署名した 5 分の JWT(client secret は送らない)
    assertion = idp.assertions[0]
    assert assertion["exp"] - assertion["iat"] == 300 and assertion["jti"]


def test_Microsoft_で_2_段階認証がまだの人は_設定してから入る(
    client: TestClient, idp: FakeProvider, conn: Connection
) -> None:
    where(idp.go(client, "microsoft", ms_claims()))
    body = client.get("/api/v1/session/challenge").json()
    assert body["status"] == "totp_setup"
    assert body["setup"]["otpauth_uri"].startswith("otpauth://totp/")
    done = client.post("/api/v1/session/totp", json={"code": pyotp.TOTP(body["setup"]["secret"]).now()})
    assert done.status_code == 200, done.text
    assert conn.execute(select(users.c.totp_enabled_at).where(users.c.id == ADMIN_ID)).scalar_one() is not None
    assert session_methods(conn) == ["microsoft"]


def test_Microsoft_のアドレスは_ドメインの持ち主が確かめたものだけ信じる(
    client: TestClient, idp: FakeProvider, conn: Connection
) -> None:
    claims = ms_claims()
    del claims["xms_edov"]
    path, query = where(idp.go(client, "microsoft", claims))
    assert query["error"] == "microsoft_not_registered"
    assert conn.execute(select(users.c.microsoft_sub).where(users.c.id == ADMIN_ID)).scalar_one() is None
    assert where(idp.go(client, "microsoft", ms_claims(xms_edov=False)))[1]["error"] == "microsoft_not_registered"


def test_Microsoft_の発行元は_入った人のテナントを当てはめたもの(client: TestClient, idp: FakeProvider) -> None:
    claims = ms_claims(iss=f"https://login.microsoftonline.com/{OTHER_TID}/v2.0")
    assert where(idp.go(client, "microsoft", claims))[1]["error"] == "microsoft_failed"
    assert where(idp.go(client, "microsoft", ms_claims(tid="not-a-tenant")))[1]["error"] == "microsoft_failed"


def test_札の無い_2_段目は_401(client: TestClient) -> None:
    response = client.get("/api/v1/session/challenge")
    assert response.status_code == 401
    assert response.json()["code"] == "login_expired"


def test_Microsoft_の設定は_両方そろい_証明書が読めなければ起動しない(
    monkeypatch: pytest.MonkeyPatch, certificate: Certificate
) -> None:
    try:
        configure(monkeypatch, certificate, google=False, microsoft=True)
        check_settings()
        monkeypatch.setenv("WORKS_MICROSOFT_CERTIFICATE", "")
        get_settings.cache_clear()
        with pytest.raises(RuntimeError, match="両方要ります"):
            check_settings()
        for broken in ("not base64!", base64.b64encode(b"no pem here").decode()):
            monkeypatch.setenv("WORKS_MICROSOFT_CERTIFICATE", broken)
            get_settings.cache_clear()
            with pytest.raises(RuntimeError):
                check_settings()
        # 秘密鍵と証明書が対になっていない
        other = make_certificate()
        pem = base64.b64decode(certificate.env)
        mixed = (
            pem.split(b"-----BEGIN CERTIFICATE-----")[0]
            + b"-----BEGIN CERTIFICATE-----"
            + (base64.b64decode(other.env).split(b"-----BEGIN CERTIFICATE-----")[1])
        )
        monkeypatch.setenv("WORKS_MICROSOFT_CERTIFICATE", base64.b64encode(mixed).decode())
        get_settings.cache_clear()
        with pytest.raises(RuntimeError, match="対になっていません"):
            check_settings()
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()
        oidc.reset()


def test_証明書の期限が近ければ知らせる(
    monkeypatch: pytest.MonkeyPatch, certificate: Certificate, caplog: pytest.LogCaptureFixture
) -> None:
    try:
        configure(monkeypatch, make_certificate(days=10), google=False, microsoft=True)
        check_settings()
        assert "証明書の期限" in caplog.text
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()
        oidc.reset()


# --- アカウントの画面から結ぶ・外す ---------------------------------------------------------------


def test_アカウントの画面から結ぶと_次からその提供元で入れる(
    client: TestClient, idp: FakeProvider, conn: Connection, admin_totp: None
) -> None:
    login_as(client, ADMIN_ID)
    # 確かめられていないアドレスでも、ログイン中の本人が結ぶなら結べる
    claims = ms_claims(sub="microsoft-9", email="taro@outlook.example", xms_edov=False)
    assert where(idp.link(client, "microsoft", claims)) == ("/account", {"linked": "microsoft"})
    assert client.get("/api/v1/account").json()["microsoft_email"] == "taro@outlook.example"
    # 結ぶときは、どのアカウントを結ぶか選ばせる
    started = client.post("/api/v1/account/identities/microsoft").json()["url"]
    assert parse_qs(urlparse(started).query)["prompt"] == ["select_account"]

    client.cookies.clear()
    where(idp.go(client, "microsoft", claims))
    assert client.post("/api/v1/session/totp", json={"code": pyotp.TOTP(SECRET).now()}).status_code == 200
    assert client.get("/api/v1/session").json()["user"]["id"] == ADMIN_ID


def test_結ぶには_10_分以内のログインが要る(client: TestClient, idp: FakeProvider) -> None:
    login_as(client, ADMIN_ID, created_at=datetime.now(UTC) - timedelta(hours=1))
    response = client.post("/api/v1/account/identities/google")
    assert response.status_code == 400
    assert response.json()["code"] == "reauth_required"


def test_ほかの人に結ばれたアカウントは結べない(client: TestClient, idp: FakeProvider, conn: Connection) -> None:
    conn.execute(update(users).where(users.c.id == MEMBER_ID).values(google_sub="google-1"))
    login_as(client, ADMIN_ID)
    assert where(idp.link(client, "google", google_claims())) == ("/account", {"link_error": "google_in_use"})
    assert conn.execute(select(users.c.google_sub).where(users.c.id == ADMIN_ID)).scalar_one() is None


@pytest.mark.parametrize("then", ["ログアウト", "別の人で入り直す"])
def test_戻る前にログアウトしていたら結ばない(
    client: TestClient, idp: FakeProvider, conn: Connection, then: str
) -> None:
    """結ぶのは、始めた人がまだ同じブラウザでログインしているときだけ(別の人のアカウントに結ばない)。"""
    login_as(client, ADMIN_ID)
    started = client.post("/api/v1/account/identities/google").json()["url"]
    client.delete("/api/v1/session")
    if then == "別の人で入り直す":
        login_as(client, MEMBER_ID)
    state = parse_qs(urlparse(started).query)["state"][0]
    code = idp.approve(started, google_claims())
    back = client.get("/api/v1/session/google/callback", params={"code": code, "state": state}, follow_redirects=False)
    assert where(back) == ("/account", {"link_error": "google_failed"})
    linked = conn.execute(select(users.c.id).where(users.c.google_sub.is_not(None))).all()
    assert linked == []


def test_外せるのは_ほかに入る手段が残るときだけ(client: TestClient, idp: FakeProvider, conn: Connection) -> None:
    conn.execute(
        update(users)
        .where(users.c.id == ADMIN_ID)
        .values(google_sub="google-1", google_email=ADMIN_EMAIL, microsoft_sub="microsoft-1")
    )
    login_as(client, ADMIN_ID)
    assert client.delete("/api/v1/account/identities/microsoft").status_code == 204
    # 残りは Google だけ(パスワードも無い)
    last = client.delete("/api/v1/account/identities/google")
    assert last.status_code == 409
    assert last.json()["code"] == "last_login_method"
    row = conn.execute(select(users.c.google_sub, users.c.microsoft_sub).where(users.c.id == ADMIN_ID)).one()
    assert (row.google_sub, row.microsoft_sub) == ("google-1", None)


def test_結ぶ口も外す口も_設定の無い提供元と未ログインは断る(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, certificate: Certificate
) -> None:
    assert client.post("/api/v1/account/identities/google").status_code == 401
    configure(monkeypatch, certificate, google=False, microsoft=False)
    try:
        login_as(client, ADMIN_ID)
        response = client.post("/api/v1/account/identities/google")
        assert response.status_code == 409
        assert response.json()["code"] == "not_configured"
        assert client.post("/api/v1/account/identities/yahoo").status_code == 400
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()
        oidc.reset()


def test_状態の_Cookie_の改ざんと期限切れは読まない(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(oidc, "metadata", lambda provider: GOOGLE_META)
    _, value = oidc.start("google", next_path="/o/tasks")
    flow = oidc.read_flow(value)
    assert flow is not None and flow.next_path == "/o/tasks" and flow.user_id is None
    # 中身を書き換えると署名が合わない(ログインの流れを、ほかの人に結ぶ流れにすり替えられない)
    body, mac = value.rsplit(".", 1)
    payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    payload["u"] = ADMIN_ID
    tampered = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    assert oidc.read_flow(f"{tampered}.{mac}") is None
    assert oidc.read_flow("garbage") is None
    # 10 分を過ぎたもの
    monkeypatch.setattr(oidc, "FLOW_TTL", timedelta(seconds=-1))
    assert oidc.read_flow(value) is None
