"""Cloudflare Access が付ける JWT を検証し、だれのリクエストかを決める(03 §5 の B 案)。

Access を通ったリクエストには `Cf-Access-Jwt-Assertion` ヘッダが付く。ここでは
署名(チームの公開鍵)・宛先(アプリの AUD タグ)・発行元(チーム)・期限を確かめて、メールアドレスを取り出す。
公開鍵は `<チーム>/cdn-cgi/access/certs` から取り、しばらく持っておく(鍵の入れ替えは未知の kid で取り直す)。
"""

from functools import lru_cache
from typing import Any

import jwt

from app.config import get_settings
from app.errors import ApiError

HEADER = "Cf-Access-Jwt-Assertion"
# Access は RS256 で署名する。ほかの方式(とくに none や HS256)は受けない
ALGORITHMS = ["RS256"]


def not_configured() -> ApiError:
    return ApiError(
        503, "auth_not_configured", "ログインの設定がありません(WORKS_ACCESS_TEAM_DOMAIN / WORKS_ACCESS_AUD)"
    )


def access_required(message: str = "Cloudflare Access を通っていません。ページを読み込み直してください") -> ApiError:
    return ApiError(401, "access_required", message)


def team_domain() -> str:
    return get_settings().access_team_domain.strip().rstrip("/")


@lru_cache
def _jwks_client(certs_url: str) -> jwt.PyJWKClient:
    # 鍵の一覧は 1 時間持つ。Access の鍵の入れ替えは 6 週ごとで、新旧が重なる期間がある
    return jwt.PyJWKClient(certs_url, cache_keys=True, lifespan=3600, timeout=10)


def signing_key(token: str) -> Any:
    """トークンの kid に合う公開鍵。テストはここを差し替える(外へ取りに行かない)。"""
    return _jwks_client(f"{team_domain()}/cdn-cgi/access/certs").get_signing_key_from_jwt(token).key


def verify(token: str | None) -> str:
    """JWT を確かめ、利用者のメールアドレス(小文字)を返す。通らなければ ApiError。"""
    settings = get_settings()
    if not team_domain() or not settings.access_aud:
        raise not_configured()
    if not token:
        raise access_required()
    try:
        claims = jwt.decode(
            token,
            signing_key(token),
            algorithms=ALGORITHMS,
            audience=settings.access_aud,
            issuer=team_domain(),
            options={"require": ["exp", "iat", "iss", "aud"]},
            leeway=30,
        )
    except jwt.PyJWKClientConnectionError as exc:
        # 公開鍵を取りに行けない。利用者のせいではないので 401 にしない
        raise ApiError(503, "access_unreachable", "Cloudflare Access の公開鍵を取れませんでした") from exc
    except jwt.PyJWTError as exc:
        raise access_required() from exc
    email = claims.get("email")
    if not isinstance(email, str) or not email:
        # サービストークン(MCP・Web フォームの送り手。06 §7)は人ではないので、画面の利用者にはならない
        raise access_required("サービストークンでは画面に入れません")
    return email.strip().lower()
