"""`GET /meta`(04 §2)。返す形の正は、画面のモックと同じ初期定義(app/seed)。"""

import json

from fastapi.testclient import TestClient
from sqlalchemy import Connection, text

from app.meta.seed import SEED_DIR


def test_未ログインでは_meta_を読めない(client: TestClient) -> None:
    assert client.get("/api/v1/meta").status_code == 401


def test_テーブルの定義は初期定義とそのまま同じ(admin: TestClient) -> None:
    """初期状態では「もう無いものを指す定義」が 1 つも無いので、掃除しても seed と一致する。"""
    got = admin.get("/api/v1/meta").json()
    want = json.loads((SEED_DIR / "objects.json").read_text(encoding="utf-8"))
    assert got["objects"] == want


def test_ビューの定義も初期定義とそのまま同じ(admin: TestClient) -> None:
    got = admin.get("/api/v1/meta").json()["views"]
    want = json.loads((SEED_DIR / "views.json").read_text(encoding="utf-8"))
    assert sorted(got, key=lambda v: (v["object"], v["position"])) == sorted(
        want, key=lambda v: (v["object"], v["position"])
    )


def test_関連先の列はビューから外れない(admin: TestClient) -> None:
    """polymorphic は論理名(related)でも実際の 2 列でも指せる(META-096)。"""
    views = admin.get("/api/v1/meta").json()["views"]
    tasks_list = next(v for v in views if v["object"] == "tasks" and v["name"] == "一覧")
    assert "related" in [c["field"] for c in tasks_list["config"]["columns"]]


def test_利用者とワークスペースが付く(admin: TestClient) -> None:
    body = admin.get("/api/v1/meta").json()
    assert [u["email"] for u in body["users"]] == ["takuya@example.jp", "misaki@example.jp"]
    assert body["users"][0]["admin"] is True
    assert "admin" not in body["users"][1]
    assert body["workspace"]["timezone"] == "Asia/Tokyo"


def test_論理削除したテーブルは_meta_に出ない(admin: TestClient, conn: Connection) -> None:
    conn.execute(text("update meta_objects set deleted_at = now() where key = 'activities'"))
    body = admin.get("/api/v1/meta").json()
    assert "activities" not in [o["key"] for o in body["objects"]]
    # 活動を指すビューも出ない(参照先のテーブルが無いので)
    assert "activities" not in [v["object"] for v in body["views"]]
    # 活動を指していた polymorphic の targets からも外れる
    tasks = next(o for o in body["objects"] if o["key"] == "tasks")
    related = next(f for f in tasks["fields"] if f["type"] == "polymorphic")
    assert "activities" not in related["targets"]


def test_外した項目は_meta_に出ず_その項目を指す列も落ちる(admin: TestClient, conn: Connection) -> None:
    conn.execute(text("update meta_fields set hidden = true where object_key = 'accounts' and key = 'industry'"))
    accounts = next(o for o in admin.get("/api/v1/meta").json()["objects"] if o["key"] == "accounts")
    assert "industry" not in [f["key"] for f in accounts["fields"]]
    view = next(
        v for v in admin.get("/api/v1/meta").json()["views"] if v["object"] == "accounts" and v["type"] == "list"
    )
    assert "industry" not in [c["field"] for c in view["config"]["columns"]]
