"""Slack への通知(04 §14)。**本物の Slack には繋がない** — `app.slack.http` の 2 つの口を偽物に差し替える。

表の行は SET-100〜SET-103(`docs/tests/settings.md` §6)。
"""

from collections.abc import Iterator
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.settings import forms as form_service
from app.slack import service
from app.slack.http import WebhookResult
from tests.conftest import ADMIN_ID, MEMBER_ID

HOOK = "https://hooks.slack.com/services/T0001/B0001/secret-part"


class FakeSlack:
    """Slack の偽物。呼ばれた要求を全部覚えておき、テストから見られるようにする。"""

    def __init__(self) -> None:
        self.api_calls: list[tuple[str, dict[str, str]]] = []
        self.posts: list[tuple[str, dict[str, Any]]] = []
        # 次の投稿の結果(空なら成功)
        self.results: list[WebhookResult] = []
        self.team = {"id": "T0001", "name": "Works デモ"}
        self.hook_url = HOOK
        self.channel = "#web-問い合わせ"
        self.enterprise = False

    def api(self, method: str, data: dict[str, str]) -> dict[str, Any]:
        self.api_calls.append((method, data))
        if method == "oauth.v2.access":
            return {
                "ok": True,
                "access_token": f"xoxb-{self.team['id']}",
                "team": self.team,
                "is_enterprise_install": self.enterprise,
                "authed_user": {"id": "U0001"},
                "incoming_webhook": {
                    "url": self.hook_url,
                    "channel": self.channel,
                    "channel_id": "C0001",
                    "configuration_url": f"https://demo.slack.com/services/{self.team['id']}",
                },
            }
        if method == "apps.uninstall":
            # アプリは llm-wiki の稼働通知と共有している。外すと、そのアプリの Webhook が全部止まる
            raise AssertionError("Slack のアプリを外してはいけない(ほかの仕組みと共有している)")
        raise AssertionError(f"偽物が知らない呼び出し: {method}")

    def webhook(self, url: str, payload: dict[str, Any]) -> WebhookResult:
        self.posts.append((url, payload))
        return self.results.pop(0) if self.results else WebhookResult(200, "ok")

    def methods(self) -> list[str]:
        return [method for method, _ in self.api_calls]


@pytest.fixture
def slack(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeSlack]:
    fake = FakeSlack()
    monkeypatch.setattr("app.slack.http.api", fake.api)
    monkeypatch.setattr("app.slack.http.webhook", fake.webhook)
    # 送り直しの待ちは数えるだけにする
    fake_waits: list[float] = []
    monkeypatch.setattr("app.slack.service.time.sleep", fake_waits.append)
    fake.waits = fake_waits  # type: ignore[attr-defined]
    # Slack アプリの資格情報がある状態にする。**署名の鍵(WORKS_SECRET_KEY)は触らない**(state が読めなくなる)
    monkeypatch.setenv("WORKS_SLACK_CLIENT_ID", "1111.2222")
    monkeypatch.setenv("WORKS_SLACK_CLIENT_SECRET", "slack-secret")
    get_settings.cache_clear()
    form_service.reset_limits()
    yield fake
    get_settings.cache_clear()


def connect(client: TestClient) -> None:
    """画面と同じ順で繋ぐ: 許可の URL をもらう → Slack から戻る。"""
    url = client.post("/api/v1/settings/slack/connect").json()["url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    back = client.get("/api/v1/slack/callback", params={"code": "auth-code", "state": state}, follow_redirects=False)
    assert back.status_code == 303, back.text
    assert back.headers["location"] == "/settings/notifications?slack=connected"


def make_form(client: TestClient, fields: list[str]) -> dict[str, Any]:
    body = {"name": "お問い合わせ", "object": "contacts", "fields": fields, "defaults": {"status": "new"}}
    response = client.post("/api/v1/settings/forms", json={**body, "enabled": True, "redirect_url": None})
    assert response.status_code == 200, response.text
    return response.json()


def status(client: TestClient) -> dict[str, Any]:
    response = client.get("/api/v1/settings/slack")
    assert response.status_code == 200, response.text
    return response.json()


def texts(payload: dict[str, Any]) -> list[str]:
    """本文の中の mrkdwn / plain_text を全部。"""
    out: list[str] = []
    for block in payload["blocks"]:
        if "text" in block:
            out.append(block["text"]["text"])
        out.extend(f["text"] for f in block.get("fields", []))
        out.extend(e["text"] for e in block.get("elements", []))
    return out


# --- 表の行(docs/tests/settings.md §6)--------------------------------------------


def test_SET_100_繋ぐとチャンネルが出て_外すと消える(admin: TestClient, slack: FakeSlack) -> None:
    assert status(admin) == {"configured": True, "connection": None}

    connect(admin)
    connection = status(admin)["connection"]
    assert connection["team_name"] == "Works デモ"
    assert connection["channel_name"] == "#web-問い合わせ"
    assert connection["configuration_url"] == "https://demo.slack.com/services/T0001"
    assert connection["connected_by"] == ADMIN_ID
    assert connection["last_sent_at"] is None
    assert connection["needs_reconnect"] is False
    # 画面へは URL もトークンも出さない
    assert "webhook_url" not in connection and "access_token" not in connection

    assert admin.delete("/api/v1/settings/slack").status_code == 204
    assert status(admin)["connection"] is None
    # Works が Webhook を捨てるだけで、Slack のアプリは外さない(共有しているアプリなので)
    assert slack.methods() == ["oauth.v2.access"]


def test_SET_101_管理者でなければ_Slack_の設定を触れない(member: TestClient, slack: FakeSlack) -> None:
    assert member.get("/api/v1/settings/slack").status_code == 403
    assert member.post("/api/v1/settings/slack/connect").status_code == 403
    assert member.post("/api/v1/settings/slack/test").status_code == 403
    assert member.delete("/api/v1/settings/slack").status_code == 403


def test_SET_102_テスト通知は結果を記録し_送れたら失敗を消す(admin: TestClient, slack: FakeSlack) -> None:
    not_yet = admin.post("/api/v1/settings/slack/test")
    assert not_yet.status_code == 409
    assert not_yet.json()["code"] == "slack_not_connected"

    connect(admin)
    sent = admin.post("/api/v1/settings/slack/test").json()["connection"]
    assert sent["last_sent_at"] is not None
    assert sent["last_error"] is None
    url, payload = slack.posts[-1]
    assert url == HOOK
    assert payload["text"] == "[Works] テスト通知"
    assert any("#web-問い合わせ" in t for t in texts(payload))

    # Webhook が消された(アプリを外された)→ 要再接続
    slack.results = [WebhookResult(404, "no_service")]
    gone = admin.post("/api/v1/settings/slack/test").json()["connection"]
    assert gone["needs_reconnect"] is True
    assert "no_service" in gone["last_error"]
    assert gone["last_error_at"] is not None

    # 送れたら失敗を消す
    healed = admin.post("/api/v1/settings/slack/test").json()["connection"]
    assert healed["last_error"] is None
    assert healed["needs_reconnect"] is False


def test_SET_103_フォームから登録があれば知らせ_bot_なら知らせない(admin: TestClient, slack: FakeSlack) -> None:
    connect(admin)
    form = make_form(admin, ["name", "email", "role", "description"])
    created = admin.post(
        f"/api/v1/forms/{form['key']}",
        data={"name": "山田 太郎", "email": "taro@example.jp", "role": "決裁者", "description": "資料を送ってください"},
    )
    assert created.status_code == 200, created.text
    record_id = created.json()["record"]["id"]

    assert len(slack.posts) == 1
    url, payload = slack.posts[0]
    assert url == HOOK
    assert payload["text"] == "[Works] Web フォーム「お問い合わせ」: 山田 太郎"
    body = texts(payload)
    assert "📨 Web フォームから登録がありました" in body
    assert "*氏名*\n山田 太郎" in body
    assert "*メール*\ntaro@example.jp" in body
    # 選択肢はラベルで
    assert "*役割*\n決裁者" in body
    # 長い文は 1 段ぶん(横に並べない)
    assert {"type": "section", "text": {"type": "mrkdwn", "text": "*メモ*\n資料を送ってください"}} in payload["blocks"]
    # 受け付けていない既定値(関係 = 新規)は載せない
    assert not any("関係" in t for t in body)
    link = f"/o/contacts?peek=contacts:{record_id}|Works で開く>"
    assert any(link in t and "フォーム「お問い合わせ」から取引先責任者に登録" in t for t in body)
    assert status(admin)["connection"]["last_sent_at"] is not None

    # bot(隠し欄が埋まっている)は知らせない
    admin.post(f"/api/v1/forms/{form['key']}", data={"name": "bot", "_gotcha": "罠"})
    assert len(slack.posts) == 1


# --- 繋ぐ ---------------------------------------------------------------------------


def test_許可の_URL_は_incoming_webhook_だけを求める(admin: TestClient, slack: FakeSlack) -> None:
    url = admin.post("/api/v1/settings/slack/connect").json()["url"]
    assert url.startswith("https://slack.com/oauth/v2/authorize?")
    query = parse_qs(urlparse(url).query)
    assert query["scope"] == ["incoming-webhook"]
    assert query["client_id"] == ["1111.2222"]
    assert query["redirect_uri"] == [f"{get_settings().public_url}/api/v1/slack/callback"]


def test_設定が無ければ繋げない(admin: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WORKS_SLACK_CLIENT_ID", "")
    monkeypatch.setenv("WORKS_SLACK_CLIENT_SECRET", "")
    get_settings.cache_clear()
    try:
        assert status(admin) == {"configured": False, "connection": None}
        res = admin.post("/api/v1/settings/slack/connect")
        assert res.status_code == 503
        assert res.json()["code"] == "slack_not_configured"
    finally:
        get_settings.cache_clear()


def test_偽の_state_では繋がらない(admin: TestClient, slack: FakeSlack) -> None:
    url = admin.post("/api/v1/settings/slack/connect").json()["url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    tampered = state[:-1] + ("0" if state[-1] != "0" else "1")
    back = admin.get("/api/v1/slack/callback", params={"code": "x", "state": tampered}, follow_redirects=False)
    assert back.headers["location"] == "/settings/notifications?slack=error"
    assert status(admin)["connection"] is None
    assert slack.api_calls == []  # Slack には問い合わせない


def test_Google_の_state_は使い回せない(admin: TestClient, slack: FakeSlack) -> None:
    from app.google import oauth

    back = admin.get(
        "/api/v1/slack/callback", params={"code": "x", "state": oauth.make_state(ADMIN_ID)}, follow_redirects=False
    )
    assert back.headers["location"] == "/settings/notifications?slack=error"


def test_許可を断られたら画面へ理由を返す(admin: TestClient, slack: FakeSlack) -> None:
    back = admin.get("/api/v1/slack/callback", params={"error": "access_denied"}, follow_redirects=False)
    assert back.status_code == 303
    assert back.headers["location"] == "/settings/notifications?slack=denied"


def test_管理者でない人の_state_では繋がない(admin: TestClient, slack: FakeSlack) -> None:
    state = service.make_state(MEMBER_ID)
    back = admin.get("/api/v1/slack/callback", params={"code": "x", "state": state}, follow_redirects=False)
    assert back.headers["location"] == "/settings/notifications?slack=error"
    assert status(admin)["connection"] is None


def test_Slack_の_Webhook_でない_URL_は保存しない(admin: TestClient, slack: FakeSlack) -> None:
    slack.hook_url = "https://evil.example/hook"
    url = admin.post("/api/v1/settings/slack/connect").json()["url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    back = admin.get("/api/v1/slack/callback", params={"code": "x", "state": state}, follow_redirects=False)
    assert back.headers["location"] == "/settings/notifications?slack=error"
    assert status(admin)["connection"] is None


def test_組織単位のインストールは断る(admin: TestClient, slack: FakeSlack) -> None:
    slack.enterprise = True
    url = admin.post("/api/v1/settings/slack/connect").json()["url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    back = admin.get("/api/v1/slack/callback", params={"code": "x", "state": state}, follow_redirects=False)
    assert back.headers["location"] == "/settings/notifications?slack=error"
    assert status(admin)["connection"] is None


def test_Webhook_の_URL_は暗号化して持ち_ボットトークンは仕舞わない(
    admin: TestClient, slack: FakeSlack, conn: Any
) -> None:
    from sqlalchemy import select

    from app.meta.tables import slack_connections
    from app.slack.store import decrypt

    connect(admin)
    row = conn.execute(select(slack_connections)).one()
    assert row.webhook_url != HOOK
    assert decrypt(row.webhook_url) == HOOK
    assert "xoxb-T0001" not in {str(v) for v in row._mapping.values()}


def test_チャンネルを選び直してもアプリは外さない(admin: TestClient, slack: FakeSlack) -> None:
    connect(admin)
    slack.channel = "#営業"
    connect(admin)
    assert status(admin)["connection"]["channel_name"] == "#営業"
    # 別のワークスペースへ繋ぎ直しても外さない
    slack.team = {"id": "T0002", "name": "別のワークスペース"}
    connect(admin)
    assert status(admin)["connection"]["team_name"] == "別のワークスペース"
    assert "apps.uninstall" not in slack.methods()


# --- 送る ---------------------------------------------------------------------------


def test_繋いでいなければ知らせない(admin: TestClient, slack: FakeSlack) -> None:
    form = make_form(admin, ["name"])
    assert admin.post(f"/api/v1/forms/{form['key']}", data={"name": "太郎"}).status_code == 200
    assert slack.posts == []


def test_人が書いた文字は_Slack_の書式をエスケープする(admin: TestClient, slack: FakeSlack) -> None:
    connect(admin)
    form = make_form(admin, ["name", "description"])
    admin.post(
        f"/api/v1/forms/{form['key']}", data={"name": "<!channel> & 太郎", "description": "<https://evil|押して>"}
    )
    _, payload = slack.posts[-1]
    joined = "\n".join([payload["text"], *texts(payload)])
    assert "<!channel>" not in joined
    assert "&lt;!channel&gt; &amp; 太郎" in joined
    assert "&lt;https://evil|押して&gt;" in joined


def test_一時的な失敗は_1_回だけ待って送り直す(admin: TestClient, slack: FakeSlack) -> None:
    connect(admin)
    slack.results = [WebhookResult(429, "rate_limited", retry_after=2.0)]
    connection = admin.post("/api/v1/settings/slack/test").json()["connection"]
    assert connection["last_error"] is None
    assert len(slack.posts) == 2
    assert slack.waits == [2.0]  # type: ignore[attr-defined]

    # 2 回とも落ちたら記録する(要再接続ではない)
    slack.results = [WebhookResult(503, ""), WebhookResult(503, "")]
    failed = admin.post("/api/v1/settings/slack/test").json()["connection"]
    assert "503" in failed["last_error"]
    assert failed["needs_reconnect"] is False


def test_送れなくてもフォームの送り手には成功を返す(admin: TestClient, slack: FakeSlack) -> None:
    connect(admin)
    form = make_form(admin, ["name"])
    slack.results = [WebhookResult(404, "channel_not_found")]
    res = admin.post(f"/api/v1/forms/{form['key']}", data={"name": "太郎"})
    assert res.status_code == 200
    connection = status(admin)["connection"]
    assert connection["needs_reconnect"] is True
    assert "channel_not_found" in connection["last_error"]


def test_長い値は_Slack_の上限の内側で切る() -> None:
    from app.slack.message import MAX_FIELD, escape, truncate

    cut = truncate(escape("&" * 3000), MAX_FIELD)
    assert len(cut) <= MAX_FIELD
    # 途中までの `&am` を残さない
    assert cut.endswith("&amp;…")
