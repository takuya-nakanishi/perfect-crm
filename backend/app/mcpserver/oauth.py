"""MCP を Claude のカスタムコネクタから使うための OAuth 2.1 認可サーバ(03 §6・04 §13)。

流れ(Claude の Web・デスクトップ・スマホ・Claude Code のどれから繋いでも同じ):

1. Claude が `/register` で自分を登録する(RFC 7591 の動的登録。公開クライアント)
2. 本人のブラウザが `/authorize` へ来る。ここは **Access の内側**なので、Access でログインした人だけが通る。
   受けた中身を `oauth_requests` に置き、画面の許可のページ(`/oauth/consent`)へ送る
3. 本人が許可すると(`POST /api/v1/oauth/requests/{id}/approve`。利用者は Access の JWT で決まる)、
   許可(`oauth_grants`)と認可コードを作り、Claude の戻り先へ送る
4. Claude のサーバが `/token` でコードをトークンに替える(PKCE S256 は SDK が確かめる)。
   以後は access token で `/mcp` を叩き、切れたら refresh token で取り直す(使うたびに新しいものへ替える)

`/register`・`/token`・`/revoke`・メタデータ・`/mcp` は Anthropic のクラウドから来るので、Access を素通しにする
(Anthropic の送信元の範囲だけ。06 §7)。守るのはここのトークン。コードとトークンは全文を保存しない(sha256)。
"""

import hashlib
import secrets
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

import anyio
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    OAuthAuthorizationServerProvider,
    RefreshToken,
    RegistrationError,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from sqlalchemy import Connection, delete, func, select, update

from app import db
from app.config import get_settings
from app.errors import not_found
from app.meta.tables import oauth_clients, oauth_codes, oauth_grants, oauth_requests, oauth_tokens, users
from app.settings import service as settings_service

SCOPE = "works"
REQUEST_TTL = timedelta(minutes=10)
CODE_TTL = timedelta(minutes=5)
ACCESS_TTL = timedelta(hours=1)
REFRESH_TTL = timedelta(days=90)

# Claude が使う戻り先(Web・デスクトップ・スマホは claude.ai 経由。Claude Code は手元の loopback)。
# ほかの戻り先を持つアプリは登録させない(知らない誰かに、許可の画面を踏ませて鍵を渡すのを防ぐ)
HOSTED_REDIRECTS = frozenset({"https://claude.ai/api/mcp/auth_callback"})
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1"})


def mcp_url() -> str:
    return f"{get_settings().public_url.rstrip('/')}/mcp"


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(UTC)


def allowed_redirect(uri: str) -> bool:
    if uri in HOSTED_REDIRECTS:
        return True
    parsed = urlparse(uri)
    # RFC 8252 の loopback。ポートは毎回変わるので見ない
    return parsed.scheme == "http" and parsed.hostname in LOOPBACK_HOSTS and parsed.path == "/callback"


async def _run[T](fn: Callable[[Connection], T]) -> T:
    """同期の DB 処理を 1 トランザクションで(SDK の口は async、こちらは同期で書く。03 §10)。"""

    def work() -> T:
        with db.transaction() as conn:
            return fn(conn)

    return await anyio.to_thread.run_sync(work)


# --- 許可の画面から呼ぶ(同期。FastAPI のルータが使う)---------------------------------------


def pending_request(conn: Connection, request_id: str) -> dict[str, Any]:
    """許可の画面に出す中身。切れていれば 404。"""
    row = conn.execute(
        select(oauth_requests, oauth_clients.c.info)
        .join(oauth_clients, oauth_clients.c.client_id == oauth_requests.c.client_id)
        .where(oauth_requests.c.id == request_id, oauth_requests.c.expires_at > func.clock_timestamp())
    ).first()
    if row is None:
        raise not_found("この許可の依頼は見つからないか、期限が切れました。Claude からもう一度繋いでください")
    redirect = urlparse(row.params["redirect_uri"])
    return {
        "id": row.id,
        "client_name": row.info.get("client_name") or "名前のないアプリ",
        "redirect_host": redirect.hostname or "",
        "scopes": row.params.get("scopes") or [SCOPE],
    }


def decide(conn: Connection, request_id: str, user_id: str, approve: bool) -> str:
    """許可するか断るかを決め、Claude の戻り先の URL を返す(画面はそこへ移る)。"""
    row = conn.execute(
        select(oauth_requests).where(
            oauth_requests.c.id == request_id, oauth_requests.c.expires_at > func.clock_timestamp()
        )
    ).first()
    if row is None:
        raise not_found("この許可の依頼は見つからないか、期限が切れました。Claude からもう一度繋いでください")
    conn.execute(delete(oauth_requests).where(oauth_requests.c.id == request_id))
    params = row.params
    if not approve:
        return construct_redirect_uri(
            params["redirect_uri"], error="access_denied", error_description="本人が断りました", state=params["state"]
        )
    scopes = params.get("scopes") or [SCOPE]
    grant_id = conn.execute(
        oauth_grants.insert()
        .values(client_id=row.client_id, user_id=user_id, scopes=scopes)
        .returning(oauth_grants.c.id)
    ).scalar_one()
    code = secrets.token_urlsafe(32)
    conn.execute(
        oauth_codes.insert().values(
            code_hash=_hash(code),
            grant_id=grant_id,
            params={**params, "scopes": scopes},
            expires_at=_now() + CODE_TTL,
        )
    )
    return construct_redirect_uri(params["redirect_uri"], code=code, state=params["state"])


def _iso(value: datetime | None) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None


def list_connections(conn: Connection) -> list[dict[str, Any]]:
    """環境設定の「接続中のアプリ」。"""
    rows = conn.execute(
        select(oauth_grants, oauth_clients.c.info, users.c.name.label("user_name"))
        .join(oauth_clients, oauth_clients.c.client_id == oauth_grants.c.client_id)
        .join(users, users.c.id == oauth_grants.c.user_id)
        .order_by(oauth_grants.c.created_at.desc())
    )
    return [
        {
            "id": str(r.id),
            "client_name": r.info.get("client_name") or "名前のないアプリ",
            "user_id": str(r.user_id),
            "user_name": r.user_name,
            "created_at": _iso(r.created_at),
            "last_used_at": _iso(r.last_used_at),
        }
        for r in rows
    ]


def revoke_connection(conn: Connection, grant_id: str) -> None:
    """接続を切る。その許可から出たトークンも消えるので、次の呼び出しから 401 になる。"""
    if conn.execute(delete(oauth_grants).where(oauth_grants.c.id == grant_id)).rowcount == 0:
        raise not_found("接続がありません")


# --- SDK から呼ばれる口 ------------------------------------------------------------------


def _issue(conn: Connection, grant_id: Any, scopes: list[str]) -> OAuthToken:
    access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    now = _now()
    conn.execute(
        oauth_tokens.insert(),
        [
            {"token_hash": _hash(access), "grant_id": grant_id, "kind": "access", "expires_at": now + ACCESS_TTL},
            {"token_hash": _hash(refresh), "grant_id": grant_id, "kind": "refresh", "expires_at": now + REFRESH_TTL},
        ],
    )
    return OAuthToken(
        access_token=access,
        token_type="Bearer",
        expires_in=int(ACCESS_TTL.total_seconds()),
        scope=" ".join(scopes),
        refresh_token=refresh,
    )


def _sweep(conn: Connection) -> None:
    """切れたものを片付ける(毎回少しずつ。数は利用者 1〜3 名ぶんしか無い)。"""
    now = func.clock_timestamp()
    conn.execute(delete(oauth_requests).where(oauth_requests.c.expires_at < now))
    conn.execute(delete(oauth_codes).where(oauth_codes.c.expires_at < now))
    conn.execute(delete(oauth_tokens).where(oauth_tokens.c.expires_at < now))


class WorksOAuthProvider(OAuthAuthorizationServerProvider[AuthorizationCode, RefreshToken, AccessToken]):
    """SDK の認可サーバの口と TokenVerifier を兼ねる。ID-JAG(企業の IdP の主張)は使わないので既定のまま断る。"""

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        def fn(conn: Connection) -> OAuthClientInformationFull | None:
            info = conn.execute(
                select(oauth_clients.c.info).where(oauth_clients.c.client_id == client_id)
            ).scalar_one_or_none()
            return OAuthClientInformationFull.model_validate(info) if info else None

        return await _run(fn)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        uris = [str(u) for u in client_info.redirect_uris or []]
        if not uris or not all(allowed_redirect(u) for u in uris):
            raise RegistrationError(
                "invalid_redirect_uri", "Works に繋げるのは Claude(claude.ai と Claude Code)だけです"
            )

        def fn(conn: Connection) -> None:
            conn.execute(
                oauth_clients.insert().values(
                    client_id=client_info.client_id, info=client_info.model_dump(mode="json", exclude_none=True)
                )
            )

        await _run(fn)

    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        request_id = secrets.token_urlsafe(24)

        def fn(conn: Connection) -> None:
            _sweep(conn)
            conn.execute(
                oauth_requests.insert().values(
                    id=request_id,
                    client_id=client.client_id,
                    params={
                        "state": params.state,
                        "scopes": params.scopes or [SCOPE],
                        "code_challenge": params.code_challenge,
                        "redirect_uri": str(params.redirect_uri),
                        "redirect_uri_provided_explicitly": params.redirect_uri_provided_explicitly,
                        "resource": params.resource,
                    },
                    expires_at=_now() + REQUEST_TTL,
                )
            )

        await _run(fn)
        # 画面の許可のページ(Access の内側)。本人が許可すると decide() が Claude へ戻す
        return f"{get_settings().public_url.rstrip('/')}/oauth/consent?request={request_id}"

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        def fn(conn: Connection) -> AuthorizationCode | None:
            row = conn.execute(
                select(oauth_codes, oauth_grants.c.client_id, oauth_grants.c.user_id)
                .join(oauth_grants, oauth_grants.c.id == oauth_codes.c.grant_id)
                .where(oauth_codes.c.code_hash == _hash(authorization_code))
            ).first()
            if row is None or row.client_id != client.client_id:
                return None
            p = row.params
            return AuthorizationCode(
                code=authorization_code,
                scopes=p["scopes"],
                expires_at=row.expires_at.timestamp(),
                client_id=row.client_id,
                code_challenge=p["code_challenge"],
                redirect_uri=p["redirect_uri"],
                redirect_uri_provided_explicitly=p["redirect_uri_provided_explicitly"],
                resource=p.get("resource"),
                subject=str(row.user_id),
            )

        return await _run(fn)

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        def fn(conn: Connection) -> OAuthToken:
            # 1 回きり。消せなかったら(二重の交換)通さない
            grant_id = conn.execute(
                delete(oauth_codes)
                .where(oauth_codes.c.code_hash == _hash(authorization_code.code))
                .returning(oauth_codes.c.grant_id)
            ).scalar_one_or_none()
            if grant_id is None:
                raise TokenError("invalid_grant", "認可コードは使用済みか、期限が切れています")
            return _issue(conn, grant_id, authorization_code.scopes)

        return await _run(fn)

    async def load_refresh_token(self, client: OAuthClientInformationFull, refresh_token: str) -> RefreshToken | None:
        def fn(conn: Connection) -> RefreshToken | None:
            row = conn.execute(
                select(oauth_tokens, oauth_grants.c.client_id, oauth_grants.c.user_id, oauth_grants.c.scopes)
                .join(oauth_grants, oauth_grants.c.id == oauth_tokens.c.grant_id)
                .where(
                    oauth_tokens.c.token_hash == _hash(refresh_token),
                    oauth_tokens.c.kind == "refresh",
                    oauth_tokens.c.expires_at > func.clock_timestamp(),
                )
            ).first()
            if row is None or row.client_id != client.client_id:
                return None
            return RefreshToken(
                token=refresh_token,
                client_id=row.client_id,
                scopes=row.scopes,
                expires_at=int(row.expires_at.timestamp()),
                resource=mcp_url(),
                subject=str(row.user_id),
            )

        return await _run(fn)

    async def exchange_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: RefreshToken, scopes: list[str]
    ) -> OAuthToken:
        def fn(conn: Connection) -> OAuthToken:
            # 使った refresh token は消し、新しい組を出す(公開クライアントは替えることが求められる)
            grant_id = conn.execute(
                delete(oauth_tokens)
                .where(oauth_tokens.c.token_hash == _hash(refresh_token.token), oauth_tokens.c.kind == "refresh")
                .returning(oauth_tokens.c.grant_id)
            ).scalar_one_or_none()
            if grant_id is None:
                raise TokenError("invalid_grant", "refresh token は使用済みか、失効しています")
            _sweep(conn)
            return _issue(conn, grant_id, [s for s in scopes if s in refresh_token.scopes] or refresh_token.scopes)

        return await _run(fn)

    async def load_access_token(self, token: str) -> AccessToken | None:
        def fn(conn: Connection) -> AccessToken | None:
            if token.startswith("wks_"):
                return _static_token(conn, token)
            row = conn.execute(
                select(oauth_tokens, oauth_grants.c.client_id, oauth_grants.c.user_id, oauth_grants.c.scopes)
                .join(oauth_grants, oauth_grants.c.id == oauth_tokens.c.grant_id)
                .join(users, users.c.id == oauth_grants.c.user_id)
                .where(
                    oauth_tokens.c.token_hash == _hash(token),
                    oauth_tokens.c.kind == "access",
                    oauth_tokens.c.expires_at > func.clock_timestamp(),
                    users.c.deleted_at.is_(None),
                )
            ).first()
            if row is None:
                return None
            conn.execute(
                update(oauth_grants)
                .where(oauth_grants.c.id == row.grant_id)
                .values(last_used_at=func.clock_timestamp())
            )
            return AccessToken(
                token=token,
                client_id=row.client_id,
                scopes=row.scopes,
                expires_at=int(row.expires_at.timestamp()),
                resource=mcp_url(),
                subject=str(row.user_id),
            )

        return await _run(fn)

    async def verify_token(self, token: str) -> AccessToken | None:
        return await self.load_access_token(token)

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        def fn(conn: Connection) -> None:
            grant_id = conn.execute(
                select(oauth_tokens.c.grant_id).where(oauth_tokens.c.token_hash == _hash(token.token))
            ).scalar_one_or_none()
            if grant_id is not None:
                conn.execute(delete(oauth_grants).where(oauth_grants.c.id == grant_id))

        await _run(fn)


def _static_token(conn: Connection, secret: str) -> AccessToken | None:
    """環境設定で発行したトークン(`wks_`。04 §10)。Codex など、ヘッダを自分で付けるアプリのため。"""
    found = settings_service.verify_token(conn, secret)
    if found is None or not found.get("created_by"):
        return None
    alive = conn.execute(
        select(users.c.id).where(users.c.id == found["created_by"], users.c.deleted_at.is_(None))
    ).first()
    if alive is None:
        return None
    return AccessToken(
        token=secret,
        client_id=f"token:{found['id']}",
        scopes=[SCOPE],
        expires_at=int(time.time()) + 3600,
        resource=mcp_url(),
        subject=found["created_by"],
    )
