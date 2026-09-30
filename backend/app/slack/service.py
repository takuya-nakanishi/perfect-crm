"""Slack との連携(04 §14): チャンネルを繋ぐ・外す・テスト通知。**画面は Webhook の URL にもトークンにも触れない**。

認可は OAuth v2 で、求める権限は `incoming-webhook` だけ。投稿先のチャンネルは Slack の認可画面で、許可する人が選ぶ。
認可が済むと、Slack が選ばれたチャンネル専用の Incoming Webhook の URL を払い出す。Works はそれを 1 チャンネルとして
仕舞う(許可を通すたびにチャンネルが増える)。どのチャンネルへ何を送るかは、ワークフローが決める(04 §15)。
state は署名だけで持つ(DB にも Cookie にも置かない。Google と同じ。04 §8)。

**Slack のワークスペースからアプリを外さない**(`apps.uninstall` を呼ばない)。アプリはほかの仕組み
(llm-wiki の稼働通知)と共有していて、外すとそのアプリが払い出した Webhook が全部止まる
(2026-08-22 に実際に止まった)。チャンネルを外すのは、Works が Webhook を捨てるだけ。
"""

import base64
import hashlib
import hmac
import re
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

from sqlalchemy import Connection, select

from app.config import get_settings
from app.errors import ApiError, bad_request, conflict, forbidden, not_found
from app.meta.tables import users
from app.security import app_secret
from app.slack import http, message, store

AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize"
SCOPE = "incoming-webhook"
# 払い出される Webhook の URL はここで始まる。それ以外は保存しない(送り先を取り違えない)
WEBHOOK_PREFIX = "https://hooks.slack.com/services/"
# 許可の画面を開いてから戻ってくるまでの猶予
STATE_MAX_AGE = 15 * 60
# 許可のあとに戻す画面。環境設定の中だけ(外の URL へは戻さない)
DEFAULT_RETURN = "/settings/slack"
RETURN_PATTERN = re.compile(r"^/settings(/[a-z][a-z-]*)*$")
# 画面から直に送るとき(テスト通知)の一時的な失敗(429・5xx・繋がらない)は、1 回だけ待って送り直す。
# 待つのは長くても 5 秒。ワークフローの通知は送り係が間を空けて試し直す(app/workflows/runner.py)
RETRY_WAIT_MAX = 5.0


def _not_configured() -> ApiError:
    return ApiError(
        503, "slack_not_configured", "Slack アプリの資格情報が入っていません。管理者が .env に入れてから繋いでください"
    )


# --- state(誰が始めた許可か・どこへ戻すか。署名だけで持つ)---------------------------


def _mac(body: str) -> str:
    # 用途を混ぜる(Google の state を Slack の戻りに使い回せないように)
    return hmac.new(app_secret().encode(), f"slack|{body}".encode(), hashlib.sha256).hexdigest()


def return_path(value: str | None) -> str:
    """戻り先として使える形なら、そのまま。違えば既定(環境設定の Slack)。"""
    return value if value and RETURN_PATTERN.match(value) else DEFAULT_RETURN


def _pack(path: str) -> str:
    return base64.urlsafe_b64encode(path.encode()).decode().rstrip("=")


def _unpack(value: str) -> str:
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)).decode()
    except ValueError:
        return DEFAULT_RETURN


def make_state(user_id: str, return_to: str = DEFAULT_RETURN) -> str:
    body = f"{user_id}|{int(time.time())}|{secrets.token_hex(8)}|{_pack(return_path(return_to))}"
    return f"{body}|{_mac(body)}"


@dataclass(frozen=True)
class State:
    user_id: str
    return_to: str


def read_state(state: str, *, now: float | None = None) -> State:
    """state から利用者の ID と戻り先を取り出す。偽物・古すぎるものは 400。"""
    parts = state.split("|")
    if len(parts) != 5:
        raise bad_request("戻り先の照合に失敗しました。もう一度お試しください", "invalid_state")
    user_id, issued, nonce, packed, mac = parts
    if not hmac.compare_digest(_mac(f"{user_id}|{issued}|{nonce}|{packed}"), mac):
        raise bad_request("戻り先の照合に失敗しました。もう一度お試しください", "invalid_state")
    if (now or time.time()) - int(issued) > STATE_MAX_AGE:
        raise bad_request("時間が経ちすぎました。もう一度お試しください", "invalid_state")
    return State(user_id, return_path(_unpack(packed)))


# --- 繋ぐ・外す -------------------------------------------------------------------


def authorize_url(user_id: str, return_to: str | None = None) -> str:
    settings = get_settings()
    if not settings.slack_enabled:
        raise _not_configured()
    params = {
        "client_id": settings.slack_client_id,
        "scope": SCOPE,
        "redirect_uri": settings.slack_redirect_uri,
        "state": make_state(user_id, return_path(return_to)),
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


def complete(conn: Connection, code: str, state: State) -> str:
    """Slack からの戻り。認可コードを Webhook の URL に替えて、1 チャンネルとして仕舞う。チャンネルの id を返す。"""
    settings = get_settings()
    if not settings.slack_enabled:
        raise _not_configured()
    # 許可の画面を開いてから戻るまでに、管理者でなくなっていないか(チャンネルはワークスペース全体の設定)
    admin = conn.execute(
        select(users.c.id).where(users.c.id == state.user_id, users.c.admin.is_(True), users.c.deleted_at.is_(None))
    ).first()
    if admin is None:
        raise forbidden()

    payload = http.api(
        "oauth.v2.access",
        {
            "client_id": settings.slack_client_id,
            "client_secret": settings.slack_client_secret,
            "code": code,
            "redirect_uri": settings.slack_redirect_uri,
        },
    )
    if not payload.get("ok"):
        raise ApiError(502, "slack_error", f"Slack が連携を受け付けませんでした({payload.get('error', '不明')})")
    if payload.get("is_enterprise_install"):
        raise bad_request("組織(Enterprise Grid)単位のインストールには対応していません", "slack_enterprise")
    hook = payload.get("incoming_webhook") or {}
    team = payload.get("team") or {}
    url = str(hook.get("url") or "")
    if not url.startswith(WEBHOOK_PREFIX):
        raise ApiError(502, "slack_error", "Slack から投稿先の URL をもらえませんでした")
    # ボットトークン(`access_token`)は仕舞わない。使い道が無い(アプリを外さない)
    return store.upsert(
        conn,
        {
            "webhook_url": url,
            "team_id": str(team.get("id") or ""),
            "team_name": str(team.get("name") or ""),
            "channel_id": str(hook.get("channel_id") or ""),
            "channel_name": str(hook.get("channel") or ""),
            "configuration_url": hook.get("configuration_url") or None,
        },
        state.user_id,
    )


def disconnect(conn: Connection, channel_id: str) -> None:
    """Works が持つ Webhook を捨てる。Slack 側の Webhook は残る(消すなら Slack のアプリの設定から)。

    ワークフローが送り先に選んでいるあいだは外せない(外すと、そのワークフローが黙って届かなくなる)。
    """
    if store.channel(conn, channel_id) is None:
        raise not_found("チャンネルがありません")
    names = store.used_by(conn, channel_id)
    if names:
        others = f"ほか {len(names) - 1} 件" if len(names) > 1 else ""
        raise conflict(
            f"ワークフロー「{names[0]}」{others}がこのチャンネルへ送っています。先にワークフローのチャンネルを替えてください",
            "channel_in_use",
        )
    store.remove(conn, channel_id)


# --- 送る -------------------------------------------------------------------------


@dataclass(frozen=True)
class Outcome:
    sent: bool
    code: str | None = None
    # 画面に出す 1 行(送れたら None)
    error: str | None = None
    # 一時的な失敗(429・5xx・繋がらない)。間を空ければ送れるかもしれない
    transient: bool = False
    retry_after: float | None = None


def transient(result: http.WebhookResult) -> bool:
    return result.status == 0 or result.status == 429 or result.status >= 500


def classify(result: http.WebhookResult) -> Outcome:
    if 200 <= result.status < 300:
        return Outcome(True)
    if result.status == 0:
        return Outcome(False, "unreachable", "Slack に繋がりませんでした", True)
    if result.status == 429:
        return Outcome(False, "rate_limited", "Slack の送信の上限に当たりました", True, result.retry_after)
    if result.status >= 500:
        return Outcome(False, "slack_down", f"Slack が応答しませんでした(HTTP {result.status})", True)
    # 失敗の本文は `no_service` のようなコード 1 語
    code = result.body if re.fullmatch(r"[a-z0-9_]{1,64}", result.body) else f"http_{result.status}"
    if code in store.RECONNECT_CODES:
        return Outcome(
            False,
            code,
            f"投稿先が使えなくなりました({code})。環境設定の Slack から、このチャンネルを繋ぎ直してください",
        )
    return Outcome(False, code, f"Slack が通知を受け付けませんでした({code})")


UNDECRYPTABLE = Outcome(
    False,
    "undecryptable",
    "保存した Slack の鍵を読めませんでした(署名鍵が変わった)。"
    "環境設定の Slack から、このチャンネルを繋ぎ直してください",
)


def post_once(target: store.Target, payload: dict[str, Any]) -> Outcome:
    """1 回だけ送る(ワークフローの送り係が使う。試し直しは送り係が間を空けて行う)。"""
    if target.webhook_url is None:
        return UNDECRYPTABLE
    return classify(http.webhook(target.webhook_url, payload))


def post(target: store.Target, payload: dict[str, Any]) -> Outcome:
    """画面から直に送る(テスト通知)。一時的な失敗は 1 回だけ待って送り直す。"""
    if target.webhook_url is None:
        return UNDECRYPTABLE
    result = http.webhook(target.webhook_url, payload)
    if transient(result):
        time.sleep(min(result.retry_after or 1.0, RETRY_WAIT_MAX))
        result = http.webhook(target.webhook_url, payload)
    return classify(result)


def send_test(conn: Connection, channel_id: str) -> None:
    """テスト通知。結果はチャンネルに記録する(送れたかは、そのチャンネルの `last_error` が空か)。"""
    target = store.target(conn, channel_id)
    if target is None:
        raise not_found("チャンネルがありません")
    outcome = post(target, message.test_message(target.channel_name))
    store.record(conn, target.id, error=outcome.error, code=outcome.code)
