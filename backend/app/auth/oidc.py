"""Google と Microsoft でログインする(OpenID Connect の認可コード + PKCE。03 §5)。

流れ: `start` が提供元の許可の画面の URL と、途中の状態を入れた Cookie の値を作る → 戻ってきたら `read_flow` で
Cookie を確かめ、`finish` がコードをトークンに替えて ID トークンを確かめ、だれなのか(`Identity`)を返す。
その人が Works のだれかを決めるのは呼ぶ側(`app/api/session.py`)。

- **途中の状態は DB に置かない。**ログインの前の口はだれからでも届くので、叩かれても行を作らない。
  Cookie `__Host-works_oidc`(10 分)に、state・戻り先・結ぶ相手を署名して入れる。PKCE の verifier と nonce は
  state から鍵(`WORKS_SECRET_KEY`)で導くので、Cookie に秘密を置かない
- 提供元の口(許可・トークン・公開鍵)は discovery document から読み、1 時間持つ。
  公開鍵は、知らない `kid` が来たら読み直す
- ID トークンは、署名(提供元の公開鍵)・発行元・宛先(クライアント ID)・期限・nonce を確かめる。
  Microsoft は公開鍵の発行元の制約も確かめる
- コードの引き換えは、送り元(IP)ごとに 1 分 10 回まで(戻りの口を叩かせて、提供元へ問い合わせを積ませない)
- Microsoft には、クライアントの証明に証明書(秘密鍵で署名した JWT)を使う。Microsoft は本番で client secret を
  使わないよう求めている(03 §13)。Google のウェブのクライアントは client secret だけ
- 外へ出る口は `call` の 1 本。テストはこれを差し替える(本物の Google・Microsoft には繋がない)
"""

import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any, Literal
from urllib.parse import urlencode

import httpx2
import jwt
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey, RSAPublicKey
from fastapi import Response

from app.auth import sessions
from app.config import get_settings
from app.security import app_secret

log = logging.getLogger(__name__)

Provider = Literal["google", "microsoft"]
PROVIDERS: tuple[Provider, ...] = ("google", "microsoft")
LABELS: dict[str, str] = {"google": "Google", "microsoft": "Microsoft"}

GOOGLE_DISCOVERY = "https://accounts.google.com/.well-known/openid-configuration"
# Google の ID トークンの発行元は、この 2 つのどちらか(03 §13)
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")
MICROSOFT_DISCOVERY = "https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration"

# Google はメールアドレスだけ。Microsoft は、アドレスが無い職場のアカウントでも
# 表示の名前(preferred_username)を出すため profile も
SCOPES: dict[str, str] = {"google": "openid email", "microsoft": "openid email profile"}

FLOW_TTL = timedelta(minutes=10)
META_TTL = 3600.0
# 知らない kid が来たときに公開鍵を読み直す間隔(偽の kid で叩かれても、提供元へ問い合わせを積ませない)
KEYS_RETRY = 60.0
# 時計のずれとして見逃す秒数(ID トークンの期限・発行時刻)
LEEWAY = 120
TIMEOUT = 10.0
# コードの引き換え(提供元のトークンの口を叩く)の間引き。1 プロセスで持つ(利用者 1〜3 名の規模)
EXCHANGE_WINDOW = 60.0
EXCHANGE_LIMIT = 10
PRUNE_OVER = 1000

_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_exchanges: dict[str, deque[float]] = defaultdict(deque)


class OidcError(Exception):
    """戻りを受け付けられなかった。理由はログにだけ残す(画面には「失敗しました」だけを出す)。"""


class TooManyExchanges(OidcError):
    """同じ送り元から、コードの引き換えが続いた。"""


@dataclass(frozen=True)
class Flow:
    """許可の画面へ送ってから戻るまでの状態(Cookie に署名して置く)。"""

    provider: str
    state: str
    next_path: str
    # 結ぶとき(アカウントの画面から)だけ、その人の ID。ログインなら None
    user_id: str | None


@dataclass(frozen=True)
class Identity:
    """提供元が確かめた人。`subject` は Google の `sub`、Microsoft の `tid:sub`(テナントを含む)。"""

    provider: str
    subject: str
    # 表示に使うアドレス(無ければ空)。小文字にそろえる
    email: str
    # アドレスの持ち主を提供元が確かめているか。真のときだけ、初めてのログインでこのアドレスの利用者を探す
    verified: bool


@dataclass(frozen=True)
class Credential:
    """Microsoft へのクライアントの証明に使う、秘密鍵と証明書の指紋。"""

    key: RSAPrivateKey
    thumbprint: str
    expires_at: datetime


@dataclass(frozen=True)
class SigningKey:
    """ID トークンの公開鍵と、その鍵を使える発行元(Microsoft の JWKS の制約)。"""

    key: RSAPublicKey
    issuer: str | None


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def enabled(provider: str) -> bool:
    s = get_settings()
    if provider == "google":
        return s.google_enabled
    if provider == "microsoft":
        return s.microsoft_enabled
    return False


def client_id(provider: str) -> str:
    s = get_settings()
    return s.google_client_id if provider == "google" else s.microsoft_client_id


def redirect_uri(provider: str) -> str:
    """提供元から戻る先。**提供元に登録した URL と 1 文字も違ってはいけない**(docs/runbook/01 §6・§6c)。"""
    return f"{get_settings().public_url.rstrip('/')}/api/v1/session/{provider}/callback"


def discovery_url(provider: str) -> str:
    if provider == "google":
        return GOOGLE_DISCOVERY
    return MICROSOFT_DISCOVERY.format(tenant=get_settings().microsoft_tenant or "common")


def cookie() -> str:
    return sessions.cookie_name("works_oidc")


def clear(response: Response) -> None:
    sessions.clear_cookie(response, cookie())


# --- 提供元を叩く ---------------------------------------------------------------------------


def _error_of(res: httpx2.Response) -> str:
    try:
        body = res.json()
    except ValueError:
        return res.text[:200]
    if isinstance(body, dict) and isinstance(body.get("error"), str):
        detail = body.get("error_description") or ""
        return f"{body['error']}{f': {detail}' if detail else ''}"[:300]
    return res.text[:200]


def call(method: str, url: str, *, data: dict[str, str] | None = None) -> dict[str, Any]:
    """提供元を叩く 1 本の口。失敗は `OidcError`(テストはこれを差し替える)。"""
    try:
        with httpx2.Client(timeout=TIMEOUT) as client:
            res = client.request(method, url, data=data, headers={"Accept": "application/json"})
    except httpx2.HTTPError as exc:
        raise OidcError(f"{url} に繋がらない({exc.__class__.__name__})") from exc
    if res.status_code >= 400:
        raise OidcError(f"{url} が {res.status_code} を返した({_error_of(res)})")
    try:
        body = res.json()
    except ValueError as exc:
        raise OidcError(f"{url} の応答が JSON でない") from exc
    if not isinstance(body, dict):
        raise OidcError(f"{url} の応答の形が違う")
    return body


def _fetch(url: str, *, fresh: bool = False) -> dict[str, Any]:
    now = time.monotonic()
    hit = _cache.get(url)
    if hit is not None and not fresh and now - hit[0] < META_TTL:
        return hit[1]
    body = call("GET", url)
    _cache[url] = (now, body)
    return body


def reset() -> None:
    """持っている discovery document・公開鍵と、引き換えの間引きを捨てる(テスト用)。"""
    _cache.clear()
    _exchanges.clear()
    _credential.cache_clear()


def metadata(provider: str) -> dict[str, Any]:
    meta = _fetch(discovery_url(provider))
    for key in ("authorization_endpoint", "token_endpoint", "jwks_uri", "issuer"):
        if not isinstance(meta.get(key), str):
            raise OidcError(f"{LABELS[provider]} の discovery document に {key} が無い")
    return meta


def _find_key(jwks: dict[str, Any], kid: str) -> SigningKey | None:
    keys = jwks.get("keys")
    if not isinstance(keys, list):
        raise OidcError("公開鍵の一覧を読めない")
    for raw in keys:
        if not isinstance(raw, dict) or raw.get("kid") != kid:
            continue
        try:
            key = jwt.PyJWK.from_dict(raw)
        except jwt.PyJWTError as exc:
            raise OidcError("公開鍵を読めない") from exc
        if isinstance(key.key, RSAPublicKey) and key.algorithm_name == "RS256" and key.public_key_use in (None, "sig"):
            issuer = raw.get("issuer")
            return SigningKey(key.key, issuer if isinstance(issuer, str) else None)
    return None


def _signing_key(jwks_uri: str, kid: str) -> SigningKey:
    key = _find_key(_fetch(jwks_uri), kid)
    if key is None:
        # 鍵の入れ替え(rollover)のあとかもしれない。読み直すのは 1 分に 1 回まで
        fetched_at = _cache.get(jwks_uri, (0.0, {}))[0]
        if time.monotonic() - fetched_at > KEYS_RETRY:
            key = _find_key(_fetch(jwks_uri, fresh=True), kid)
    if key is None:
        raise OidcError(f"ID トークンの公開鍵(kid={kid})が見つからない")
    return key


# --- 途中の状態(Cookie)--------------------------------------------------------------------


def _mac(body: str) -> str:
    return hmac.new(app_secret().encode(), f"oidc-flow|{body}".encode(), hashlib.sha256).hexdigest()


def _derive(purpose: str, state: str) -> str:
    """state から導く値(PKCE の verifier と nonce)。鍵を知らなければ、state を見ても作れない。"""
    return _b64(hmac.new(app_secret().encode(), f"oidc-{purpose}|{state}".encode(), hashlib.sha256).digest())


def start(provider: str, *, next_path: str, user_id: str | None = None) -> tuple[str, str]:
    """許可の画面の URL と、Cookie に置く値。`user_id` があれば、ログインではなく、その人に結ぶ。"""
    meta = metadata(provider)
    state = secrets.token_urlsafe(32)
    payload = {"p": provider, "s": state, "n": next_path, "u": user_id, "t": int(time.time())}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    params = {
        "client_id": client_id(provider),
        "redirect_uri": redirect_uri(provider),
        "response_type": "code",
        "scope": SCOPES[provider],
        "state": state,
        "nonce": _derive("nonce", state),
        "code_challenge": _b64(hashlib.sha256(_derive("pkce", state).encode()).digest()),
        "code_challenge_method": "S256",
    }
    if provider == "microsoft":
        params["response_mode"] = "query"
    if user_id is not None:
        # 結ぶときは、どのアカウントを結ぶかを選ばせる(ブラウザに残っている別のアカウントを黙って結ばない)
        params["prompt"] = "select_account"
    return f"{meta['authorization_endpoint']}?{urlencode(params)}", f"{body}.{_mac(body)}"


def read_flow(value: str | None) -> Flow | None:
    """Cookie の値を確かめて読む。無い・偽物・10 分を過ぎた → None。"""
    if not value or "." not in value:
        return None
    body, mac = value.rsplit(".", 1)
    if not hmac.compare_digest(_mac(body), mac):
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except ValueError:
        return None
    if not isinstance(data, dict) or not isinstance(data.get("t"), int):
        return None
    if time.time() - data["t"] > FLOW_TTL.total_seconds():
        return None
    provider, state, next_path, user_id = data.get("p"), data.get("s"), data.get("n"), data.get("u")
    if provider not in PROVIDERS or not isinstance(state, str) or not isinstance(next_path, str):
        return None
    return Flow(
        provider=provider, state=state, next_path=next_path, user_id=user_id if isinstance(user_id, str) else None
    )


# --- 戻り: コードを替えて、ID トークンを確かめる -------------------------------------------------


def _allow_exchange(ip: str | None) -> bool:
    now = time.monotonic()
    if len(_exchanges) > PRUNE_OVER:
        for stale in [k for k, q in _exchanges.items() if not q or now - q[-1] > EXCHANGE_WINDOW]:
            del _exchanges[stale]
    seen = _exchanges[ip or "unknown"]
    while seen and now - seen[0] > EXCHANGE_WINDOW:
        seen.popleft()
    if len(seen) >= EXCHANGE_LIMIT:
        return False
    seen.append(now)
    return True


def finish(flow: Flow, code: str, ip: str | None) -> Identity:
    """コードをトークンに替え、ID トークンを確かめて、だれなのかを返す。"""
    if not _allow_exchange(ip):
        raise TooManyExchanges(f"{ip} からコードの引き換えが続いた")
    provider = flow.provider
    meta = metadata(provider)
    form = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri(provider),
        "client_id": client_id(provider),
        "code_verifier": _derive("pkce", flow.state),
    }
    if provider == "google":
        form["client_secret"] = get_settings().google_client_secret
    else:
        form["client_assertion_type"] = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
        form["client_assertion"] = client_assertion(meta["token_endpoint"])
    payload = call("POST", meta["token_endpoint"], data=form)
    id_token = payload.get("id_token")
    if not isinstance(id_token, str):
        raise OidcError("トークンの応答に id_token が無い")
    claims = _verify(provider, meta, id_token, _derive("nonce", flow.state))
    return identity_of(provider, claims)


def _issuers(provider: str, meta: dict[str, Any], claims: dict[str, Any]) -> tuple[str, ...]:
    if provider == "google":
        return GOOGLE_ISSUERS
    # Microsoft の common・organizations の discovery document は、発行元を `…/{tenantid}/v2.0` の型で載せる。
    # ID トークンの tid(入った人のテナント)を当てはめたものと、ID トークンの iss が同じであること
    tid = claims.get("tid")
    if not isinstance(tid, str) or not re.fullmatch(
        r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", tid
    ):
        return ()
    return (str(meta["issuer"]).replace("{tenantid}", tid),)


def _verify(provider: str, meta: dict[str, Any], id_token: str, nonce: str) -> dict[str, Any]:
    try:
        header = jwt.get_unverified_header(id_token)
    except jwt.PyJWTError as exc:
        raise OidcError("ID トークンを読めない") from exc
    if header.get("alg") != "RS256":
        raise OidcError(f"ID トークンの署名の方式が {header.get('alg')}")
    kid = header.get("kid")
    if not isinstance(kid, str) or not kid:
        raise OidcError("ID トークンの公開鍵の ID(kid)が無い")
    key = _signing_key(meta["jwks_uri"], kid)
    try:
        claims: dict[str, Any] = jwt.decode(
            id_token,
            key.key,
            algorithms=["RS256"],
            audience=client_id(provider),
            leeway=LEEWAY,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise OidcError(f"ID トークンが通らない({exc})") from exc
    if claims["iss"] not in _issuers(provider, meta, claims):
        raise OidcError(f"ID トークンの発行元が違う({claims['iss']})")
    if provider == "microsoft" and (
        key.issuer is None or key.issuer.replace("{tenantid}", claims["tid"]) != claims["iss"]
    ):
        raise OidcError("ID トークンの公開鍵を使える発行元が違う")
    if not isinstance(claims.get("nonce"), str) or not hmac.compare_digest(claims["nonce"], nonce):
        raise OidcError("ID トークンの nonce が違う")
    return claims


def _true(value: Any) -> bool:
    return value is True or value in ("true", "True", "1", 1)


def identity_of(provider: str, claims: dict[str, Any]) -> Identity:
    email = claims.get("email") if isinstance(claims.get("email"), str) else ""
    email = str(email).strip().lower()
    subject = str(claims["sub"])
    if provider == "google":
        # Google が持ち主だと言えるのは、Gmail のアドレスか、Workspace の利用者(hd がある)だけ。ほかのアドレスは、
        # アカウントを作った時点で確かめただけで、今の持ち主かは分からない(03 §13)
        verified = (
            _true(claims.get("email_verified"))
            and bool(email)
            and (bool(claims.get("hd")) or email.endswith("@gmail.com"))
        )
        return Identity(provider, subject, email, verified)
    # Microsoft の email は、確かめられていないことがあり、変わりもする(03 §13)。アドレスのドメインの持ち主が
    # 確かめたもの(省略できる claim の xms_edov。アプリ登録の「トークン構成」で足す)だけを信じる
    verified = bool(email) and _true(claims.get("xms_edov"))
    shown = email or str(claims.get("preferred_username") or "").strip().lower()
    # Microsoft の sub はテナントの中で解釈する。同じ sub の別テナントを同じ利用者へ結ばない
    return Identity(provider, f"{claims['tid']}:{subject}", shown, verified)


# --- Microsoft へのクライアントの証明(証明書)-----------------------------------------------------


@lru_cache(maxsize=1)
def _credential(value: str) -> Credential:
    """`WORKS_MICROSOFT_CERTIFICATE`(秘密鍵と証明書の PEM を続けて base64 で 1 行にしたもの)を読む。"""
    try:
        pem = base64.b64decode("".join(value.split()), validate=True)
    except ValueError as exc:
        raise ValueError("WORKS_MICROSOFT_CERTIFICATE を base64 として読めません") from exc
    key_block = re.search(rb"-----BEGIN (RSA )?PRIVATE KEY-----.+?-----END (RSA )?PRIVATE KEY-----", pem, re.S)
    cert_block = re.search(rb"-----BEGIN CERTIFICATE-----.+?-----END CERTIFICATE-----", pem, re.S)
    if key_block is None or cert_block is None:
        raise ValueError("WORKS_MICROSOFT_CERTIFICATE には、暗号化していない秘密鍵と証明書の両方が要ります")
    key = serialization.load_pem_private_key(key_block.group(0), password=None)
    if not isinstance(key, RSAPrivateKey):
        raise ValueError("WORKS_MICROSOFT_CERTIFICATE の鍵は RSA にしてください(署名は PS256)")
    cert = x509.load_pem_x509_certificate(cert_block.group(0))
    public = cert.public_key()
    if not isinstance(public, RSAPublicKey) or public.public_numbers() != key.public_key().public_numbers():
        raise ValueError("WORKS_MICROSOFT_CERTIFICATE の秘密鍵と証明書が対になっていません")
    return Credential(key=key, thumbprint=_b64(cert.fingerprint(hashes.SHA256())), expires_at=cert.not_valid_after_utc)


def credential() -> Credential:
    return _credential(get_settings().microsoft_certificate)


def check_credential() -> None:
    """起動のときに確かめる。読めなければ止め(黙って動かさない)、期限が近ければ知らせる。"""
    try:
        cred = credential()
    except ValueError as exc:
        raise RuntimeError(f"{exc}(docs/runbook/01 §6c)") from exc
    left = cred.expires_at - datetime.now(UTC)
    if left < timedelta(days=30):
        log.warning(
            "Microsoft でログインの証明書の期限が %s です。作り直して Entra にも上げてください(docs/runbook/01 §6c)",
            cred.expires_at.date().isoformat(),
        )


def client_assertion(token_endpoint: str) -> str:
    """証明書の秘密鍵で署名した JWT(Microsoft の certificate credentials の形。03 §13)。5 分だけ効く。"""
    cred = credential()
    s = get_settings()
    now = int(time.time())
    claims = {
        "aud": token_endpoint,
        "iss": s.microsoft_client_id,
        "sub": s.microsoft_client_id,
        "jti": str(uuid.uuid4()),
        "nbf": now,
        "iat": now,
        "exp": now + 300,
    }
    return jwt.encode(claims, cred.key, algorithm="PS256", headers={"x5t#S256": cred.thumbprint})
