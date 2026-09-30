"""ワークフロー(04 §15)。**本物の Slack には繋がない**(`test_slack.py` の偽物を使う)。

表の行は WF-001〜(`docs/tests/workflows.md`)と SET-103(`docs/tests/settings.md` §6)。
送り係のスレッドは起こさず(conftest)、`runner.run_due()` を直に呼んで送る。
"""

import importlib.util
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Connection, select, text

from app.meta.tables import workflow_runs, workflows
from app.slack.http import WebhookResult
from app.workflows import runner
from tests.conftest import ADMIN_ID
from tests.test_slack import HOOK, FakeSlack, connect, slack, texts

__all__ = ["slack"]  # 偽の Slack の fixture を、このファイルでも使う


def new_workflow(channel: str, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "name": "新しい取引先責任者",
        "object": "contacts",
        "enabled": True,
        "trigger": {"event": "created", "origins": ["app", "form", "mcp", "auto"]},
        "actions": [{"id": "a1", "type": "slack", "channel": channel, "fields": ["email", "status", "description"]}],
    }
    body.update(overrides)
    return body


def create(client: TestClient, body: dict[str, Any]) -> dict[str, Any]:
    response = client.post("/api/v1/settings/workflows", json=body)
    assert response.status_code == 200, response.text
    return dict(response.json())


def listed(client: TestClient) -> list[dict[str, Any]]:
    response = client.get("/api/v1/settings/workflows")
    assert response.status_code == 200, response.text
    return list(response.json())


def runs(client: TestClient, workflow_id: str) -> list[dict[str, Any]]:
    response = client.get(f"/api/v1/settings/workflows/{workflow_id}/runs")
    assert response.status_code == 200, response.text
    return list(response.json())


def contact(client: TestClient, **values: Any) -> dict[str, Any]:
    response = client.post("/api/v1/objects/contacts/records", json={"name": "山田 太郎", **values})
    assert response.status_code == 200, response.text
    return dict(response.json()["record"])


def patch(client: TestClient, record_id: str, **values: Any) -> None:
    response = client.patch(f"/api/v1/objects/contacts/records/{record_id}", json=values)
    assert response.status_code == 200, response.text


def form(client: TestClient, fields: list[str]) -> dict[str, Any]:
    body = {"name": "お問い合わせ", "object": "contacts", "fields": fields, "defaults": {"status": "new"}}
    response = client.post("/api/v1/settings/forms", json={**body, "enabled": True, "redirect_url": None})
    assert response.status_code == 200, response.text
    return dict(response.json())


@pytest.fixture
def channel(admin: TestClient, slack: FakeSlack) -> str:
    return connect(admin)


# --- 定義(docs/tests/workflows.md §1)-----------------------------------------------


def test_WF_001_作ると一覧に出て_直すと変わる(admin: TestClient, channel: str) -> None:
    created = create(admin, new_workflow(channel))
    assert created["name"] == "新しい取引先責任者"
    assert created["object"] == "contacts"
    assert created["enabled"] is True
    assert created["trigger"] == {"event": "created", "origins": ["app", "form", "mcp", "auto"]}
    assert created["actions"] == [
        {"id": "a1", "type": "slack", "channel": channel, "fields": ["email", "status", "description"]}
    ]
    assert created["created_by"] == ADMIN_ID
    assert created["last_run"] is None
    assert created["problems"] == []
    assert [w["id"] for w in listed(admin)] == [created["id"]]

    body = new_workflow(
        channel,
        name="  有望な責任者  ",
        enabled=False,
        trigger={"event": "matched", "filter": {"field": "status", "op": "eq", "value": "active"}, "origins": ["app"]},
    )
    updated = admin.put(f"/api/v1/settings/workflows/{created['id']}", json=body).json()
    assert updated["name"] == "有望な責任者"
    assert updated["enabled"] is False
    assert updated["trigger"]["event"] == "matched"
    assert updated["trigger"]["filter"] == {"field": "status", "op": "eq", "value": "active"}
    # 「どこから」は画面の並び(app → form → mcp → auto → import)に揃える
    body["trigger"]["origins"] = ["import", "app"]
    assert admin.put(f"/api/v1/settings/workflows/{created['id']}", json=body).json()["trigger"]["origins"] == [
        "app",
        "import",
    ]


def test_WF_002_管理者でなければ触れない(admin: TestClient, channel: str) -> None:
    created = create(admin, new_workflow(channel))
    admin.post("/api/v1/session", json={"email": "misaki@example.jp", "password": "x"})
    wid = created["id"]
    assert admin.get("/api/v1/settings/workflows").status_code == 403
    assert admin.post("/api/v1/settings/workflows", json=new_workflow(channel)).status_code == 403
    assert admin.put(f"/api/v1/settings/workflows/{wid}", json=new_workflow(channel)).status_code == 403
    assert admin.delete(f"/api/v1/settings/workflows/{wid}").status_code == 403
    assert admin.post(f"/api/v1/settings/workflows/{wid}/restore").status_code == 403
    assert admin.get(f"/api/v1/settings/workflows/{wid}/runs").status_code == 403
    assert admin.post("/api/v1/settings/workflows/test", json=new_workflow(channel)).status_code == 403
    run_id = "00000000-0000-7000-8000-000000000000"
    assert admin.post(f"/api/v1/settings/workflows/runs/{run_id}/retry").status_code == 403


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"name": "  "}, "名前を入力"),
        ({"object": "nothing"}, "テーブルを選んで"),
        ({"trigger": {"event": "deleted", "origins": ["app"]}}, "いつ動かすか"),
        ({"trigger": {"event": "matched", "origins": ["app"]}}, "条件を 1 つ以上"),
        ({"trigger": {"event": "created", "origins": []}}, "1 つ以上選んで"),
        ({"trigger": {"event": "created", "origins": ["email"]}}, "どこからの書き込み"),
        ({"actions": []}, "アクションを 1 つ以上"),
        ({"actions": [{"id": "a1", "type": "email"}]}, "知らないアクション"),
        (
            {
                "actions": [
                    {"id": "a1", "type": "slack", "channel": "CHANNEL", "fields": []},
                    {"id": "a1", "type": "slack", "channel": "CHANNEL", "fields": []},
                ]
            },
            "id が正しくありません",
        ),
        ({"actions": [{"id": "a1", "type": "slack", "channel": None, "fields": []}]}, "チャンネルを選んで"),
        ({"actions": [{"id": "a1", "type": "slack", "channel": "CHANNEL", "fields": ["nothing"]}]}, "載せる項目"),
    ],
)
def test_WF_003_形の不備は_400(admin: TestClient, channel: str, change: dict[str, Any], message: str) -> None:
    body = new_workflow(channel, **change)
    for action in body["actions"]:
        if action.get("channel") == "CHANNEL":
            action["channel"] = channel
    response = admin.post("/api/v1/settings/workflows", json=body)
    assert response.status_code == 400, response.text
    assert message in response.json()["message"]
    assert listed(admin) == []


@pytest.mark.parametrize(
    ("filter_", "message"),
    [
        ({"field": "owner_id", "op": "eq", "value": "$me"}, "「自分」は使えません"),
        (
            {"and": [{"field": "status", "op": "eq", "value": "new"}, {"field": "nothing", "op": "eq", "value": 1}]},
            "条件",
        ),
        ({"field": "last_contacted_on", "op": "lt", "value": "あした"}, "条件"),
    ],
)
def test_WF_004_条件の不備は_400(admin: TestClient, channel: str, filter_: dict[str, Any], message: str) -> None:
    body = new_workflow(channel, trigger={"event": "matched", "filter": filter_, "origins": ["app"]})
    response = admin.post("/api/v1/settings/workflows", json=body)
    assert response.status_code == 400, response.text
    assert message in response.json()["message"]


def test_WF_005_削除は元に戻せて_実行記録も残る(admin: TestClient, channel: str) -> None:
    created = create(admin, new_workflow(channel))
    contact(admin)
    runner.run_due()
    assert admin.delete(f"/api/v1/settings/workflows/{created['id']}").status_code == 204
    assert listed(admin) == []
    assert admin.get(f"/api/v1/settings/workflows/{created['id']}/runs").status_code == 404
    restored = admin.post(f"/api/v1/settings/workflows/{created['id']}/restore")
    assert restored.status_code == 200, restored.text
    assert restored.json()["last_run"]["status"] == "done"
    assert len(runs(admin, created["id"])) == 1
    # 削除していないものは戻せない
    assert admin.post(f"/api/v1/settings/workflows/{created['id']}/restore").status_code == 404


# --- 発火(docs/tests/workflows.md §2)-------------------------------------------------


def test_WF_010_作成されたときは作成でだけ動き_条件があれば満たすときだけ(
    admin: TestClient, slack: FakeSlack, channel: str
) -> None:
    every = create(admin, new_workflow(channel))
    only_new = create(
        admin,
        new_workflow(
            channel,
            name="新規の責任者",
            trigger={
                "event": "created",
                "filter": {"field": "status", "op": "eq", "value": "new"},
                "origins": ["app"],
            },
        ),
    )
    record = contact(admin, status="active", email="taro@example.jp")
    queued = runs(admin, every["id"])
    assert [(r["status"], r["event"], r["origin"], r["record_name"]) for r in queued] == [
        ("queued", "created", "app", "山田 太郎")
    ]
    assert queued[0]["record_id"] == record["id"]
    assert queued[0]["actor_id"] == ADMIN_ID
    assert queued[0]["target"] == "#web-問い合わせ"
    assert runs(admin, only_new["id"]) == []

    assert runner.run_due() == 1
    assert [r["status"] for r in runs(admin, every["id"])] == ["done"]
    assert len(slack.posts) == 1
    assert slack.posts[0][0] == HOOK
    assert listed(admin)[0]["last_run"]["status"] == "done"

    # 更新では動かない
    patch(admin, record["id"], status="new")
    assert len(runs(admin, every["id"])) == 1
    assert runs(admin, only_new["id"]) == []
    # 条件を満たす作成で動く
    contact(admin, status="new")
    assert len(runs(admin, only_new["id"])) == 1


def test_WF_011_条件を満たしたときは_満たした瞬間に_1_回(admin: TestClient, channel: str) -> None:
    body = new_workflow(
        channel,
        name="有望",
        trigger={"event": "matched", "filter": {"field": "status", "op": "eq", "value": "active"}, "origins": ["app"]},
    )
    created = create(admin, body)
    record = contact(admin, status="new")
    assert runs(admin, created["id"]) == []
    patch(admin, record["id"], status="active")
    assert [r["event"] for r in runs(admin, created["id"])] == ["matched"]
    # 満たしたまま別の項目を変えても動かない
    patch(admin, record["id"], title="部長")
    assert len(runs(admin, created["id"])) == 1
    # 外れてから、また満たせばもう 1 回
    patch(admin, record["id"], status="dormant")
    patch(admin, record["id"], status="active")
    assert len(runs(admin, created["id"])) == 2
    # 作ったときに満たしていれば、作成で動く
    contact(admin, name="田中 花子", status="active")
    assert [r["record_name"] for r in runs(admin, created["id"])][0] == "田中 花子"


def test_WF_012_どこからの書き込みで動くかを選べる(admin: TestClient, channel: str) -> None:
    only_forms = create(
        admin, new_workflow(channel, name="フォームだけ", trigger={"event": "created", "origins": ["form"]})
    )
    everything = create(admin, new_workflow(channel, name="既定"))
    contact(admin)
    assert runs(admin, only_forms["id"]) == []
    assert len(runs(admin, everything["id"])) == 1

    submitted = form(admin, ["name", "email"])
    admin.post(f"/api/v1/forms/{submitted['key']}", data={"name": "フォームの人"})
    assert [r["origin"] for r in runs(admin, only_forms["id"])] == ["form"]
    assert runs(admin, only_forms["id"])[0]["actor_id"] is None

    # CSV の取り込みは、既定の「どこから」に入っていない(100 件入れると 100 通届く)
    imported = admin.post("/api/v1/objects/contacts/import", json={"csv": "氏名\nCSV の人\n"})
    assert imported.status_code == 200, imported.text
    assert len(runs(admin, everything["id"])) == 2
    with_import = create(
        admin, new_workflow(channel, name="取り込みも", trigger={"event": "created", "origins": ["import"]})
    )
    admin.post("/api/v1/objects/contacts/import", json={"csv": "氏名\nCSV の人 2\n"})
    assert [r["origin"] for r in runs(admin, with_import["id"])] == ["import"]


def test_WF_012_繰り返しの次回は自動作成として動く(admin: TestClient, channel: str) -> None:
    body = {
        "name": "新しいタスク",
        "object": "tasks",
        "enabled": True,
        "trigger": {"event": "created", "origins": ["auto"]},
        "actions": [{"id": "a1", "type": "slack", "channel": channel, "fields": ["due_date"]}],
    }
    created = create(admin, body)
    weekly = {"title": "週報", "due_date": "2026-10-01", "repeat": "weekly"}
    task = admin.post("/api/v1/objects/tasks/records", json=weekly)
    assert task.status_code == 200, task.text
    assert runs(admin, created["id"]) == []
    done = admin.patch(f"/api/v1/objects/tasks/records/{task.json()['record']['id']}", json={"status": "done"})
    assert done.status_code == 200, done.text
    assert [(r["origin"], r["record_name"]) for r in runs(admin, created["id"])] == [("auto", "週報")]


def test_WF_013_オフと削除中のワークフローは動かない(admin: TestClient, channel: str) -> None:
    off = create(admin, new_workflow(channel, name="オフ", enabled=False))
    removed = create(admin, new_workflow(channel, name="削除中"))
    admin.delete(f"/api/v1/settings/workflows/{removed['id']}")
    contact(admin)
    assert runs(admin, off["id"]) == []
    admin.post(f"/api/v1/settings/workflows/{removed['id']}/restore")
    assert runs(admin, removed["id"]) == []


# --- 送る(docs/tests/workflows.md §3)--------------------------------------------------


def test_WF_014_本文はワークフローの名前_表示名_選んだ項目_どこから(
    admin: TestClient, slack: FakeSlack, channel: str
) -> None:
    create(admin, new_workflow(channel))
    record = contact(admin, email="taro@example.jp", status="active", description="資料を送ってください")
    runner.run_due()
    _, payload = slack.posts[-1]
    assert payload["text"] == "[Works] 新しい取引先責任者: 山田 太郎"
    body = texts(payload)
    assert body[0] == "新しい取引先責任者"
    assert body[1] == "*山田 太郎*"
    assert "*メール*\ntaro@example.jp" in body
    # 選択肢はラベルで
    assert "*関係*\nやり取り中" in body
    # 長い文は 1 段ぶん(横に並べない)
    assert {"type": "section", "text": {"type": "mrkdwn", "text": "*メモ*\n資料を送ってください"}} in payload["blocks"]
    link = f"/o/contacts?peek=contacts:{record['id']}|Works で開く>"
    assert any(link in t and "取引先責任者に作成" in t and "Takuya(画面)" in t for t in body)


def test_WF_014_人が書いた文字は_Slack_の書式をエスケープする(
    admin: TestClient, slack: FakeSlack, channel: str
) -> None:
    create(admin, new_workflow(channel))
    submitted = form(admin, ["name", "description"])
    admin.post(
        f"/api/v1/forms/{submitted['key']}", data={"name": "<!channel> & 太郎", "description": "<https://evil|押して>"}
    )
    runner.run_due()
    _, payload = slack.posts[-1]
    joined = "\n".join([payload["text"], *texts(payload)])
    assert "<!channel>" not in joined
    assert "&lt;!channel&gt; &amp; 太郎" in joined
    assert "&lt;https://evil|押して&gt;" in joined
    assert "Web フォーム「お問い合わせ」" in joined


def test_WF_015_一時的な失敗は間を空けて試し直し_失われた投稿先は_1_回で失敗(
    admin: TestClient, slack: FakeSlack, channel: str, conn: Connection
) -> None:
    created = create(admin, new_workflow(channel))
    contact(admin)

    def due_now() -> None:
        conn.execute(workflow_runs.update().values(next_attempt_at=text("clock_timestamp()")))

    slack.results = [WebhookResult(503, "")]
    runner.run_due()
    first = runs(admin, created["id"])[0]
    assert first["status"] == "queued"
    assert first["attempts"] == 1
    assert "503" in first["error"]
    # 次を試すまで間を空ける(30 秒)。すぐには拾わない
    assert runner.run_due() == 0

    # 5 回目も駄目なら失敗にする
    for _ in range(4):
        slack.results = [WebhookResult(503, "")]
        due_now()
        runner.run_due()
    failed = runs(admin, created["id"])[0]
    assert failed["status"] == "failed"
    assert failed["attempts"] == 5
    assert "5 回試しました" in failed["error"]

    # 投稿先が失われた類は 1 回で失敗し、チャンネルが要再接続になる
    contact(admin, name="次の人")
    slack.results = [WebhookResult(404, "channel_not_found")]
    runner.run_due()
    gone = runs(admin, created["id"])[0]
    assert gone["status"] == "failed"
    assert gone["attempts"] == 1
    assert "channel_not_found" in gone["error"]
    channels = admin.get("/api/v1/settings/slack").json()["channels"]
    assert channels[0]["needs_reconnect"] is True
    assert "要再接続" in listed(admin)[0]["problems"][0]


def test_WF_015_Retry_After_が長ければそれに従う(
    admin: TestClient, slack: FakeSlack, channel: str, conn: Connection
) -> None:
    create(admin, new_workflow(channel))
    contact(admin)
    slack.results = [WebhookResult(429, "rate_limited", retry_after=600.0)]
    runner.run_due()
    wait = conn.execute(
        select(workflow_runs.c.next_attempt_at - workflow_runs.c.updated_at).where(workflow_runs.c.status == "queued")
    ).scalar_one()
    assert 590 <= wait.total_seconds() <= 610


def test_WF_016_動かす前にオフや削除にされたら見送る(admin: TestClient, slack: FakeSlack, channel: str) -> None:
    created = create(admin, new_workflow(channel))
    contact(admin)
    admin.put(f"/api/v1/settings/workflows/{created['id']}", json=new_workflow(channel, enabled=False))
    runner.run_due()
    skipped = runs(admin, created["id"])[0]
    assert skipped["status"] == "skipped"
    assert "オフ" in skipped["error"]
    assert slack.posts == []


def test_WF_017_失敗と見送りは送り直せる(admin: TestClient, slack: FakeSlack, channel: str) -> None:
    created = create(admin, new_workflow(channel))
    contact(admin)
    slack.results = [WebhookResult(404, "channel_not_found")]
    runner.run_due()
    failed = runs(admin, created["id"])[0]
    retried = admin.post(f"/api/v1/settings/workflows/runs/{failed['id']}/retry")
    assert retried.status_code == 200, retried.text
    assert retried.json()["status"] == "queued"
    assert retried.json()["error"] is None
    runner.run_due()
    assert runs(admin, created["id"])[0]["status"] == "done"
    # 送ったものは送り直せない
    again = admin.post(f"/api/v1/settings/workflows/runs/{failed['id']}/retry")
    assert again.status_code == 409
    assert admin.post("/api/v1/settings/workflows/runs/not-a-uuid/retry").status_code == 404


def test_WF_018_書き込みが取り消されたら実行記録も残らない(
    admin: TestClient, channel: str, conn: Connection, monkeypatch: pytest.MonkeyPatch
) -> None:
    created = create(admin, new_workflow(channel))
    # 検証で落ちた書き込み(400)は何も残さない
    refused = admin.post("/api/v1/objects/contacts/records", json={"name": ""})
    assert refused.status_code == 400
    assert runs(admin, created["id"]) == []

    # ワークフローの側が壊れても、レコードの書き込みは止めない
    def broken(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("壊れた")

    monkeypatch.setattr("app.workflows.actions.slack.SlackKind.prepare", broken)
    record = contact(admin, name="それでも作れる")
    assert record["name"] == "それでも作れる"
    assert runs(admin, created["id"]) == []


def test_WF_019_無い項目を指す条件のワークフローは動かず_問題に出る(
    admin: TestClient, channel: str, conn: Connection
) -> None:
    body = new_workflow(
        channel,
        trigger={"event": "created", "filter": {"field": "status", "op": "eq", "value": "new"}, "origins": ["app"]},
    )
    created = create(admin, body)
    # 項目を外した(定義からは見えなくなる。列の値は残る)
    conn.execute(text("update meta_fields set hidden = true where object_key = 'contacts' and key = 'status'"))
    contact(admin)
    assert runs(admin, created["id"]) == []
    assert "status" in listed(admin)[0]["problems"][0]


def test_WF_020_テスト送信は保存前の定義で_最新のレコードを送り_実行記録に残さない(
    admin: TestClient, slack: FakeSlack, channel: str
) -> None:
    contact(admin, name="古い人")
    contact(admin, name="新しい人", email="new@example.jp")
    body = new_workflow(channel, name="まだ保存していない")
    sent = admin.post("/api/v1/settings/workflows/test", json=body)
    assert sent.status_code == 200, sent.text
    assert sent.json()["record"]["name"] == "新しい人"
    assert sent.json()["results"] == [{"action_id": "a1", "ok": True, "error": None}]
    _, payload = slack.posts[-1]
    assert payload["blocks"][0]["text"]["text"] == "[テスト] まだ保存していない"
    assert "*メール*\nnew@example.jp" in texts(payload)
    assert listed(admin) == []

    # 送れなければ理由が返る
    slack.results = [WebhookResult(404, "no_service")]
    failed = admin.post("/api/v1/settings/workflows/test", json=body).json()["results"][0]
    assert failed["ok"] is False
    assert "no_service" in failed["error"]


def test_WF_020_レコードが無ければ見本で送る(admin: TestClient, slack: FakeSlack, channel: str) -> None:
    table = {
        "key": "leads",
        "label": "リード",
        "icon": "user-plus",
        "color": "teal",
        "fields": [
            {"key": "name", "label": "氏名", "type": "text"},
            {"key": "company", "label": "会社", "type": "text"},
        ],
    }
    assert admin.post("/api/v1/meta/objects", json=table).status_code == 200
    body = new_workflow(
        channel, object="leads", actions=[{"id": "a1", "type": "slack", "channel": channel, "fields": ["company"]}]
    )
    sent = admin.post("/api/v1/settings/workflows/test", json=body).json()
    assert sent["record"] is None
    assert "*会社*\n(会社)" in texts(slack.posts[-1][1])


def test_SET_103_Web_フォームの登録を知らせ_bot_なら知らせない(
    admin: TestClient, slack: FakeSlack, channel: str
) -> None:
    created = create(admin, new_workflow(channel, trigger={"event": "created", "origins": ["form"]}))
    submitted = form(admin, ["name", "email"])
    response = admin.post(f"/api/v1/forms/{submitted['key']}", data={"name": "山田 太郎", "email": "taro@example.jp"})
    assert response.status_code == 200, response.text
    runner.run_due()
    assert len(slack.posts) == 1
    assert "*メール*\ntaro@example.jp" in texts(slack.posts[0][1])
    # bot(隠し欄が埋まっている)は、レコードを作らないので知らせない
    admin.post(f"/api/v1/forms/{submitted['key']}", data={"name": "bot", "_gotcha": "罠"})
    runner.run_due()
    assert len(runs(admin, created["id"])) == 1
    assert len(slack.posts) == 1


# --- 移行(docs/tests/workflows.md §4)---------------------------------------------------


def _migration() -> Any:
    path = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "0008_workflows.py"
    spec = importlib.util.spec_from_file_location("migration_0008", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_WF_021_これまでの_Web_フォームの通知は_同じ動きのワークフローになる(
    admin: TestClient, channel: str, conn: Connection
) -> None:
    form(admin, ["name", "email"])
    form(admin, ["email", "phone"])
    carry_over = _migration().carry_over_form_notice
    assert carry_over(conn) == 1
    made = listed(admin)
    assert [(w["name"], w["object"], w["enabled"]) for w in made] == [("Web フォームからの登録", "contacts", True)]
    assert made[0]["trigger"] == {"event": "created", "origins": ["form"]}
    action = made[0]["actions"][0]
    assert (action["type"], action["channel"], action["fields"]) == ("slack", channel, ["name", "email", "phone"])
    assert made[0]["problems"] == []

    # Slack と繋いでいなければ(これまでも送っていない)作らない
    conn.execute(workflows.delete())
    conn.execute(text("delete from slack_connections"))
    assert carry_over(conn) == 0
