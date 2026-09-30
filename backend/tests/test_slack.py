"""Slack のチャンネル(04 §14)。**本物の Slack には繋がない** — `app.slack.http` の 2 つの口を偽物に差し替える。

表の行は SET-100〜SET-108(`docs/tests/settings.md` §6)。Slack へ知らせる本体(ワークフロー)は `test_workflows.py`。
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
from tests.conftest import ADMIN_ID, MEMBER_ID, login_as

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
        self.channel_id = "C0001"
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
                    "channel_id": self.channel_id,
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
    # 送り直しの待ちは数えるだけにする(画面からのテスト通知と、送り係の間隔)
    fake_waits: list[float] = []
    monkeypatch.setattr("app.slack.service.time.sleep", fake_waits.append)
    monkeypatch.setattr("app.workflows.runner.time.sleep", fake_waits.append)
    fake.waits = fake_waits  # type: ignore[attr-defined]
    # Slack アプリの資格情報がある状態にする。**署名の鍵(WORKS_SECRET_KEY)は触らない**(state が読めなくなる)
    monkeypatch.setenv("WORKS_SLACK_CLIENT_ID", "1111.2222")
    monkeypatch.setenv("WORKS_SLACK_CLIENT_SECRET", "slack-secret")
    get_settings.cache_clear()
    form_service.reset_limits()
    yield fake
    get_settings.cache_clear()


def connect(client: TestClient, return_to: str | None = None) -> str:
    """画面と同じ順で繋ぐ: 許可の URL をもらう → Slack から戻る。繋いだチャンネルの id を返す。"""
    body = {"return_to": return_to} if return_to else None
    url = client.post("/api/v1/settings/slack/connect", json=body).json()["url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    back = client.get("/api/v1/slack/callback", params={"code": "auth-code", "state": state}, follow_redirects=False)
    assert back.status_code == 303, back.text
    location = urlparse(back.headers["location"])
    assert location.path == (return_to or "/settings/slack")
    query = parse_qs(location.query)
    assert query["slack"] == ["connected"], back.headers["location"]
    return query["channel"][0]


def status(client: TestClient) -> dict[str, Any]:
    response = client.get("/api/v1/settings/slack")
    assert response.status_code == 200, response.text
    return response.json()


def channel(client: TestClient, channel_id: str) -> dict[str, Any]:
    return next(c for c in status(client)["channels"] if c["id"] == channel_id)


def texts(payload: dict[str, Any]) -> list[str]:
    """本文の中の mrkdwn / plain_text を全部。"""
    out: list[str] = []
    for block in payload["blocks"]:
        if "text" in block:
            out.append(block["text"]["text"])
        out.extend(f["text"] for f in block.get("fields", []))
        out.extend(e["text"] for e in block.get("elements", []))
    return out


def back_to(client: TestClient, params: dict[str, str]) -> str:
    back = client.get("/api/v1/slack/callback", params=params, follow_redirects=False)
    assert back.status_code == 303, back.text
    return str(back.headers["location"])


# --- 表の行(docs/tests/settings.md §6)--------------------------------------------


def test_SET_100_チャンネルを繋ぐと並び_繋ぎ直しても増えず_外すと消える(admin: TestClient, slack: FakeSlack) -> None:
    assert status(admin) == {"configured": True, "channels": []}

    first = connect(admin)
    found = channel(admin, first)
    assert found["team_name"] == "Works デモ"
    assert found["channel_name"] == "#web-問い合わせ"
    assert found["configuration_url"] == "https://demo.slack.com/services/T0001"
    assert found["connected_by"] == ADMIN_ID
    assert found["last_sent_at"] is None
    assert found["needs_reconnect"] is False
    # 画面へは URL もトークンも出さない
    assert "webhook_url" not in found and "access_token" not in found

    # 別のチャンネルを繋ぐと、もう 1 行
    slack.channel, slack.channel_id = "#営業", "C0002"
    second = connect(admin)
    assert second != first
    assert [c["channel_name"] for c in status(admin)["channels"]] == ["#web-問い合わせ", "#営業"]

    # 同じチャンネルを繋ぎ直すと、行は増えず(id も同じ)、名前と Webhook が新しくなる
    slack.channel, slack.channel_id = "#営業-改名", "C0002"
    assert connect(admin) == second
    assert [c["channel_name"] for c in status(admin)["channels"]] == ["#web-問い合わせ", "#営業-改名"]

    assert admin.delete(f"/api/v1/settings/slack/{first}").status_code == 204
    assert [c["id"] for c in status(admin)["channels"]] == [second]
    # Works が Webhook を捨てるだけで、Slack のアプリは外さない(共有しているアプリなので)
    assert set(slack.methods()) == {"oauth.v2.access"}


def test_SET_101_管理者でなければ_Slack_の設定を触れない(admin: TestClient, slack: FakeSlack) -> None:
    channel_id = connect(admin)
    login_as(admin, MEMBER_ID)
    assert admin.get("/api/v1/settings/slack").status_code == 403
    assert admin.post("/api/v1/settings/slack/connect").status_code == 403
    assert admin.post(f"/api/v1/settings/slack/{channel_id}/test").status_code == 403
    assert admin.delete(f"/api/v1/settings/slack/{channel_id}").status_code == 403
    login_as(admin, ADMIN_ID)
    assert [c["id"] for c in status(admin)["channels"]] == [channel_id]


def test_SET_102_テスト通知は結果を記録し_送れたら失敗を消す(admin: TestClient, slack: FakeSlack) -> None:
    missing = admin.post("/api/v1/settings/slack/00000000-0000-7000-8000-000000000000/test")
    assert missing.status_code == 404
    assert admin.post("/api/v1/settings/slack/not-a-uuid/test").status_code == 404

    channel_id = connect(admin)
    sent = admin.post(f"/api/v1/settings/slack/{channel_id}/test")
    assert sent.status_code == 200, sent.text
    found = next(c for c in sent.json()["channels"] if c["id"] == channel_id)
    assert found["last_sent_at"] is not None
    assert found["last_error"] is None
    url, payload = slack.posts[-1]
    assert url == HOOK
    assert payload["text"] == "[Works] テスト通知"
    assert any("#web-問い合わせ" in t for t in texts(payload))

    # Webhook が消された(アプリを外された)→ 要再接続
    slack.results = [WebhookResult(404, "no_service")]
    admin.post(f"/api/v1/settings/slack/{channel_id}/test")
    gone = channel(admin, channel_id)
    assert gone["needs_reconnect"] is True
    assert "no_service" in gone["last_error"]
    assert gone["last_error_at"] is not None

    # 送れたら失敗を消す
    admin.post(f"/api/v1/settings/slack/{channel_id}/test")
    healed = channel(admin, channel_id)
    assert healed["last_error"] is None
    assert healed["needs_reconnect"] is False


def test_SET_107_ワークフローが使っているチャンネルは外せない(admin: TestClient, slack: FakeSlack) -> None:
    channel_id = connect(admin)
    body = {
        "name": "新しい取引先責任者",
        "object": "contacts",
        "enabled": True,
        "trigger": {"event": "created", "origins": ["app"]},
        "actions": [{"id": "a1", "type": "slack", "channel": channel_id, "fields": ["email"]}],
    }
    workflow = admin.post("/api/v1/settings/workflows", json=body).json()
    refused = admin.delete(f"/api/v1/settings/slack/{channel_id}")
    assert refused.status_code == 409
    assert refused.json()["code"] == "channel_in_use"
    assert "新しい取引先責任者" in refused.json()["message"]
    # ワークフローを削除すれば(削除中は数えない)外せる
    assert admin.delete(f"/api/v1/settings/workflows/{workflow['id']}").status_code == 204
    assert admin.delete(f"/api/v1/settings/slack/{channel_id}").status_code == 204


def test_SET_108_許可のあとは頼んだ画面へ戻し_環境設定の外へは戻さない(admin: TestClient, slack: FakeSlack) -> None:
    connect(admin, return_to="/settings/workflows")
    for outside in ("https://evil.example/", "//evil.example", "/o/contacts", "/settings/../o"):
        url = admin.post("/api/v1/settings/slack/connect", json={"return_to": outside}).json()["url"]
        state = parse_qs(urlparse(url).query)["state"][0]
        assert back_to(admin, {"code": "x", "state": state}).startswith("/settings/slack?")


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
        assert status(admin) == {"configured": False, "channels": []}
        res = admin.post("/api/v1/settings/slack/connect")
        assert res.status_code == 503
        assert res.json()["code"] == "slack_not_configured"
    finally:
        get_settings.cache_clear()


def test_偽の_state_では繋がらない(admin: TestClient, slack: FakeSlack) -> None:
    url = admin.post("/api/v1/settings/slack/connect", json={"return_to": "/settings/workflows"}).json()["url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    tampered = state[:-1] + ("0" if state[-1] != "0" else "1")
    # 読めない state の戻り先は信じない(環境設定の Slack へ)
    assert back_to(admin, {"code": "x", "state": tampered}) == "/settings/slack?slack=error"
    assert status(admin)["channels"] == []
    assert slack.api_calls == []  # Slack には問い合わせない


def test_Google_の_state_は使い回せない(admin: TestClient, slack: FakeSlack) -> None:
    from app.google import oauth

    assert back_to(admin, {"code": "x", "state": oauth.make_state(ADMIN_ID)}) == "/settings/slack?slack=error"


def test_許可を断られたら頼んだ画面へ理由を返す(admin: TestClient, slack: FakeSlack) -> None:
    url = admin.post("/api/v1/settings/slack/connect", json={"return_to": "/settings/workflows"}).json()["url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    assert back_to(admin, {"error": "access_denied", "state": state}) == "/settings/workflows?slack=denied"
    assert back_to(admin, {"error": "access_denied"}) == "/settings/slack?slack=denied"


def test_管理者でない人の_state_では繋がない(admin: TestClient, slack: FakeSlack) -> None:
    state = service.make_state(MEMBER_ID)
    assert back_to(admin, {"code": "x", "state": state}) == "/settings/slack?slack=error"
    assert status(admin)["channels"] == []


def test_Slack_の_Webhook_でない_URL_は保存しない(admin: TestClient, slack: FakeSlack) -> None:
    slack.hook_url = "https://evil.example/hook"
    url = admin.post("/api/v1/settings/slack/connect").json()["url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    assert back_to(admin, {"code": "x", "state": state}) == "/settings/slack?slack=error"
    assert status(admin)["channels"] == []


def test_組織単位のインストールは断る(admin: TestClient, slack: FakeSlack) -> None:
    slack.enterprise = True
    url = admin.post("/api/v1/settings/slack/connect").json()["url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    assert back_to(admin, {"code": "x", "state": state}) == "/settings/slack?slack=error"
    assert status(admin)["channels"] == []


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


def test_繋ぎ直すと要再接続が消え_アプリは外さない(admin: TestClient, slack: FakeSlack) -> None:
    channel_id = connect(admin)
    slack.results = [WebhookResult(404, "channel_is_archived")]
    admin.post(f"/api/v1/settings/slack/{channel_id}/test")
    assert channel(admin, channel_id)["needs_reconnect"] is True
    assert connect(admin) == channel_id
    assert channel(admin, channel_id)["needs_reconnect"] is False
    # 別のワークスペースへ繋いでも外さない
    slack.team = {"id": "T0002", "name": "別のワークスペース"}
    connect(admin)
    assert len(status(admin)["channels"]) == 2
    assert "apps.uninstall" not in slack.methods()


def test_外すチャンネルが無ければ_404(admin: TestClient, slack: FakeSlack) -> None:
    assert admin.delete("/api/v1/settings/slack/00000000-0000-7000-8000-000000000000").status_code == 404
    assert admin.delete("/api/v1/settings/slack/not-a-uuid").status_code == 404


# --- 送る ---------------------------------------------------------------------------


def test_一時的な失敗は_1_回だけ待って送り直す(admin: TestClient, slack: FakeSlack) -> None:
    channel_id = connect(admin)
    slack.results = [WebhookResult(429, "rate_limited", retry_after=2.0)]
    admin.post(f"/api/v1/settings/slack/{channel_id}/test")
    assert channel(admin, channel_id)["last_error"] is None
    assert len(slack.posts) == 2
    assert slack.waits == [2.0]  # type: ignore[attr-defined]

    # 2 回とも落ちたら記録する(要再接続ではない)
    slack.results = [WebhookResult(503, ""), WebhookResult(503, "")]
    admin.post(f"/api/v1/settings/slack/{channel_id}/test")
    failed = channel(admin, channel_id)
    assert "503" in failed["last_error"]
    assert failed["needs_reconnect"] is False


def test_長い値は_Slack_の上限の内側で切る() -> None:
    from app.slack.message import MAX_FIELD, escape, truncate

    cut = truncate(escape("&" * 3000), MAX_FIELD)
    assert len(cut) <= MAX_FIELD
    # 途中までの `&am` を残さない
    assert cut.endswith("&amp;…")
