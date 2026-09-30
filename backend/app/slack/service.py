"""Slack との連携(04 §14): 繋ぐ・外す・送る。**画面は Webhook の URL にもトークンにも触れない**。

認可は OAuth v2 で、求める権限は `incoming-webhook` だけ。投稿先のチャンネルは Slack の認可画面で、許可する人が選ぶ。
認可が済むと、Slack が選ばれたチャンネル専用の Incoming Webhook の URL を払い出す。Works はそこへ投稿する。
state は署名だけで持つ(DB にも Cookie にも置かない。Google と同じ。04 §8)。
"""

import hashlib
import hmac
import logging
import re
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

from sqlalchemy import Connection, select

from app import db
from app.config import get_settings
from app.errors import ApiError, bad_request, conflict, forbidden
from app.meta.tables import users, web_forms
from app.security import app_secret
from app.slack import http, message, store

AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize"
SCOPE = "incoming-webhook"
# 払い出される Webhook の URL はここで始まる。それ以外は保存しない(送り先を取り違えない)
WEBHOOK_PREFIX = "https://hooks.slack.com/services/"
# 許可の画面を開いてから戻ってくるまでの猶予
STATE_MAX_AGE = 15 * 60
# 一時的な失敗(429・5xx・繋がらない)は 1 回だけ待って送り直す。待つのは長くても 5 秒
RETRY_WAIT_MAX = 5.0

log = logging.getLogger("works.slack")


def _not_configured() -> ApiError:
    return ApiError(
        503, "slack_not_configured", "Slack アプリの資格情報が入っていません。管理者が .env に入れてから繋いでください"
    )


# --- state(誰が始めた許可か。署名だけで持つ)---------------------------------------


def _mac(body: str) -> str:
    # 用途を混ぜる(Google の state を Slack の戻りに使い回せないように)
    return hmac.new(app_secret().encode(), f"slack|{body}".encode(), hashlib.sha256).hexdigest()


def make_state(user_id: str) -> str:
    body = f"{user_id}|{int(time.time())}|{secrets.token_hex(8)}"
    return f"{body}|{_mac(body)}"


def read_state(state: str, *, now: float | None = None) -> str:
    """state から利用者の ID を取り出す。偽物・古すぎるものは 400。"""
    parts = state.split("|")
    if len(parts) != 4:
        raise bad_request("戻り先の照合に失敗しました。もう一度お試しください", "invalid_state")
    user_id, issued, nonce, mac = parts
    if not hmac.compare_digest(_mac(f"{user_id}|{issued}|{nonce}"), mac):
        raise bad_request("戻り先の照合に失敗しました。もう一度お試しください", "invalid_state")
    if (now or time.time()) - int(issued) > STATE_MAX_AGE:
        raise bad_request("時間が経ちすぎました。もう一度お試しください", "invalid_state")
    return user_id


# --- 繋ぐ・外す -------------------------------------------------------------------


def authorize_url(user_id: str) -> str:
    settings = get_settings()
    if not settings.slack_enabled:
        raise _not_configured()
    params = {
        "client_id": settings.slack_client_id,
        "scope": SCOPE,
        "redirect_uri": settings.slack_redirect_uri,
        "state": make_state(user_id),
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


def complete(conn: Connection, code: str, state: str) -> None:
    """Slack からの戻り。認可コードを Webhook の URL に替えて仕舞う。"""
    settings = get_settings()
    if not settings.slack_enabled:
        raise _not_configured()
    user_id = read_state(state)
    # 許可の画面を開いてから戻るまでに、管理者でなくなっていないか(繋ぎ先はワークスペース全体の設定)
    admin = conn.execute(
        select(users.c.id).where(users.c.id == user_id, users.c.admin.is_(True), users.c.deleted_at.is_(None))
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
    team_id = str(team.get("id") or "")
    previous = store.replace(
        conn,
        {
            "webhook_url": url,
            "access_token": str(payload.get("access_token") or ""),
            "team_id": team_id,
            "team_name": str(team.get("name") or ""),
            "channel_id": str(hook.get("channel_id") or ""),
            "channel_name": str(hook.get("channel") or ""),
            "configuration_url": hook.get("configuration_url") or None,
        },
        user_id,
    )
    # 別のワークスペースへ繋ぎ直したら、前のワークスペースからアプリを外す。
    # **同じワークスペースなら外さない**(インストールは 1 つで、外すと新しい Webhook も止まる)
    if previous is not None and previous.team_id != team_id and previous.access_token:
        _uninstall(previous.access_token)


def _uninstall(token: str) -> None:
    """Slack のワークスペースからアプリを外す。失敗しても Works 側の繋ぎ先は消えたまま(ログにだけ残す)。"""
    settings = get_settings()
    if not settings.slack_enabled:
        return
    try:
        res = http.api(
            "apps.uninstall",
            {"token": token, "client_id": settings.slack_client_id, "client_secret": settings.slack_client_secret},
        )
    except ApiError as exc:
        log.warning("Slack からアプリを外せませんでした: %s", exc.message)
        return
    if not res.get("ok"):
        log.warning("Slack からアプリを外せませんでした: %s", res.get("error"))


def disconnect(conn: Connection) -> None:
    token = store.remove(conn)
    if token:
        _uninstall(token)


# --- 送る -------------------------------------------------------------------------


@dataclass(frozen=True)
class Outcome:
    sent: bool
    code: str | None = None
    # 画面に出す 1 行(送れたら None)
    error: str | None = None


def _transient(result: http.WebhookResult) -> bool:
    return result.status == 0 or result.status == 429 or result.status >= 500


def _classify(result: http.WebhookResult) -> Outcome:
    if 200 <= result.status < 300:
        return Outcome(True)
    if result.status == 0:
        return Outcome(False, "unreachable", "Slack に繋がりませんでした")
    if result.status == 429:
        return Outcome(False, "rate_limited", "Slack の送信の上限に当たりました")
    if result.status >= 500:
        return Outcome(False, "slack_down", f"Slack が応答しませんでした(HTTP {result.status})")
    # 失敗の本文は `no_service` のようなコード 1 語
    code = result.body if re.fullmatch(r"[a-z0-9_]{1,64}", result.body) else f"http_{result.status}"
    if code in store.RECONNECT_CODES:
        return Outcome(
            False, code, f"投稿先が使えなくなりました({code})。「チャンネルを選び直す」から繋ぎ直してください"
        )
    return Outcome(False, code, f"Slack が通知を受け付けませんでした({code})")


def _post(target: store.Target, payload: dict[str, Any]) -> Outcome:
    if target.webhook_url is None:
        return Outcome(
            False,
            "undecryptable",
            "保存した Slack の鍵を読めませんでした(署名鍵が変わった)。「チャンネルを選び直す」から繋ぎ直してください",
        )
    result = http.webhook(target.webhook_url, payload)
    if _transient(result):
        time.sleep(min(result.retry_after or 1.0, RETRY_WAIT_MAX))
        result = http.webhook(target.webhook_url, payload)
    return _classify(result)


def notify(payload: dict[str, Any]) -> None:
    """応答のあとに走る(BackgroundTasks)。**DB のトランザクションを持ったまま Slack を待たない**。

    失敗は繋ぎ先に記録し(画面に出る)、ログに残すだけで、投げない。レコードはもうできている。
    """
    try:
        with db.transaction() as conn:
            target = store.target(conn)
        if target is None:
            return
        outcome = _post(target, payload)
        with db.transaction() as conn:
            store.record(conn, target.id, error=outcome.error, code=outcome.code)
        if not outcome.sent:
            log.warning("Slack へ通知できませんでした: %s", outcome.code)
    except Exception:
        log.exception("Slack への通知で思わぬ失敗")


def send_test(conn: Connection) -> None:
    """テスト通知。結果は繋ぎ先に記録する(送れたかは、状態の `last_error` が空か)。"""
    target = store.target(conn)
    if target is None:
        raise conflict("Slack と連携していません", "slack_not_connected")
    outcome = _post(target, message.test_message(target.channel_name))
    store.record(conn, target.id, error=outcome.error, code=outcome.code)


def form_notice(conn: Connection, key: str, created: dict[str, Any]) -> dict[str, Any] | None:
    """Web フォームで作ったレコードの知らせ。Slack と繋いでいなければ None(何も送らない)。"""
    if not store.connected(conn):
        return None
    form = conn.execute(
        select(web_forms.c.name, web_forms.c.object_key, web_forms.c.fields).where(web_forms.c.key == key)
    ).first()
    if form is None:
        return None
    return message.form_submission(conn, form.name, form.object_key, list(form.fields), created["record"])
