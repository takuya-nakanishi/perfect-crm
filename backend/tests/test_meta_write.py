"""テーブル設定とビューの書き込み(04 §6、決まりは 02 §5)。管理者の制限は 03 §5。"""

from typing import Any

from fastapi.testclient import TestClient


def meta(client: TestClient) -> dict[str, Any]:
    return client.get("/api/v1/meta").json()


def objects(client: TestClient) -> dict[str, Any]:
    return {o["key"]: o for o in meta(client)["objects"]}


def simple_table(key: str = "projects", **extra: Any) -> dict[str, Any]:
    return {
        "key": key,
        "label": "案件",
        "icon": "box",
        "color": "blue",
        "fields": [
            {"key": "name", "label": "名前", "type": "text"},
            {
                "key": "phase",
                "label": "段階",
                "type": "select",
                "options": [
                    {"value": "todo", "label": "未着手", "color": "gray"},
                    {"value": "doing", "label": "進行中", "color": "blue"},
                ],
            },
        ],
        **extra,
    }


def test_テーブルを作ると実テーブルもできてレコードを書ける(admin: TestClient) -> None:
    response = admin.post("/api/v1/meta/objects", json=simple_table())
    assert response.status_code == 200, response.text
    assert "projects" in {o["key"] for o in response.json()["objects"]}
    created = admin.post("/api/v1/objects/projects/records", json={"name": "はじめての案件"})
    assert created.status_code == 200, created.text
    assert created.json()["record"]["name"] == "はじめての案件"
    assert admin.post("/api/v1/objects/projects/records/query", json={"q": "はじめて"}).json()["total"] == 1


def test_テーブルを作ると一覧とカンバンが用意される(admin: TestClient) -> None:
    body = admin.post("/api/v1/meta/objects", json=simple_table()).json()
    mine = [v for v in body["views"] if v["object"] == "projects"]
    assert {v["type"] for v in mine} == {"list", "kanban"}
    assert next(v for v in mine if v["type"] == "kanban")["config"]["group_by"] == "phase"


def test_管理者でなければテーブルを作れない(member: TestClient) -> None:
    response = member.post("/api/v1/meta/objects", json=simple_table())
    assert response.status_code == 403
    assert response.json()["code"] == "forbidden"


def test_META_004_列名が規則外のテーブルは_400(admin: TestClient) -> None:
    """大文字・先頭が数字・40 文字超は作れない(02 §5)。"""
    assert admin.post("/api/v1/meta/objects", json=simple_table("Projects")).status_code == 400
    assert admin.post("/api/v1/meta/objects", json=simple_table("1projects")).status_code == 400
    assert admin.post("/api/v1/meta/objects", json=simple_table("a" * 41)).status_code == 400
    # 40 文字ちょうどは通る(境界)
    assert admin.post("/api/v1/meta/objects", json=simple_table("a" * 40)).status_code == 200
    # 項目の列名も同じ規則
    body = simple_table("valid_table")
    body["fields"][1]["key"] = "Phase"
    assert admin.post("/api/v1/meta/objects", json=body).status_code == 400


def test_予約された名前のテーブルは作れない(admin: TestClient) -> None:
    assert admin.post("/api/v1/meta/objects", json=simple_table("users")).status_code == 400
    assert admin.post("/api/v1/meta/objects", json=simple_table("accounts")).status_code == 400


def test_先頭の項目は文字でなければならない(admin: TestClient) -> None:
    body = simple_table()
    body["fields"] = [{"key": "amount", "label": "金額", "type": "currency"}]
    assert admin.post("/api/v1/meta/objects", json=body).status_code == 400


def test_項目を足すと列が増え_一覧の列にも入る(admin: TestClient) -> None:
    admin.post("/api/v1/meta/objects", json=simple_table())
    body = simple_table()
    body["fields"].append({"key": "budget", "label": "予算", "type": "currency"})
    response = admin.put("/api/v1/meta/objects/projects", json=body)
    assert response.status_code == 200, response.text
    fields = {f["key"] for f in objects(admin)["projects"]["fields"]}
    assert "budget" in fields
    listing = next(v for v in meta(admin)["views"] if v["object"] == "projects" and v["type"] == "list")
    assert "budget" in [c["field"] for c in listing["config"]["columns"]]
    created = admin.post("/api/v1/objects/projects/records", json={"name": "予算つき", "budget": 1000})
    assert created.json()["record"]["budget"] == 1000


def test_項目を外しても値は残り_同じ列名で戻せば復活する(admin: TestClient) -> None:
    admin.post("/api/v1/meta/objects", json=simple_table())
    record = admin.post("/api/v1/objects/projects/records", json={"name": "案件", "phase": "doing"}).json()["record"]
    without = simple_table()
    without["fields"] = [without["fields"][0]]
    assert admin.put("/api/v1/meta/objects/projects", json=without).status_code == 200
    assert "phase" not in {f["key"] for f in objects(admin)["projects"]["fields"]}
    # 外した項目は書けない(定義に無い列)
    assert admin.patch(f"/api/v1/objects/projects/records/{record['id']}", json={"phase": "todo"}).status_code == 400
    # 戻すと元の定義で復活し、値も残っている
    assert admin.put("/api/v1/meta/objects/projects", json=simple_table()).status_code == 200
    back = admin.get(f"/api/v1/objects/projects/records/{record['id']}").json()["record"]
    assert back["phase"] == "doing"


def test_同じ列名を別の型では戻せない(admin: TestClient) -> None:
    admin.post("/api/v1/meta/objects", json=simple_table())
    without = simple_table()
    without["fields"] = [without["fields"][0]]
    admin.put("/api/v1/meta/objects/projects", json=without)
    changed = simple_table()
    changed["fields"][1] = {"key": "phase", "label": "段階", "type": "number"}
    assert admin.put("/api/v1/meta/objects/projects", json=changed).status_code == 400


def test_型は変えられない(admin: TestClient) -> None:
    admin.post("/api/v1/meta/objects", json=simple_table())
    body = simple_table()
    body["fields"][1] = {"key": "phase", "label": "段階", "type": "text"}
    assert admin.put("/api/v1/meta/objects/projects", json=body).status_code == 400


def test_表示名の項目は外せない(admin: TestClient) -> None:
    admin.post("/api/v1/meta/objects", json=simple_table())
    body = simple_table()
    body["fields"] = [body["fields"][1]]
    assert admin.put("/api/v1/meta/objects/projects", json=body).status_code == 400


def test_完了の仕組みが使う選択肢は外せない(admin: TestClient) -> None:
    tasks = objects(admin)["tasks"]
    body = {
        "key": "tasks",
        "label": tasks["label"],
        "icon": tasks["icon"],
        "color": tasks["color"],
        "fields": [
            {k: v for k, v in f.items() if k in ("key", "label", "type", "required", "options", "target")}
            for f in tasks["fields"]
            if not f.get("readonly")
        ],
    }
    status = next(f for f in body["fields"] if f["key"] == "status")
    status["options"] = [o for o in status["options"] if o["value"] != "done"]
    response = admin.put("/api/v1/meta/objects/tasks", json=body)
    assert response.status_code == 400
    assert "完了の仕組み" in response.json()["message"]


def test_初めからあるテーブルは削除できない(admin: TestClient) -> None:
    response = admin.delete("/api/v1/meta/objects/accounts")
    assert response.status_code == 400
    assert "初めから入っている" in response.json()["message"]


def test_テーブルの削除は論理削除で_レコードごと戻る(admin: TestClient) -> None:
    admin.post("/api/v1/meta/objects", json=simple_table())
    admin.post("/api/v1/objects/projects/records", json={"name": "残る案件"})
    assert admin.delete("/api/v1/meta/objects/projects").status_code == 200
    assert "projects" not in objects(admin)
    assert admin.post("/api/v1/meta/objects/projects/restore").status_code == 200
    assert admin.post("/api/v1/objects/projects/records/query", json={}).json()["total"] == 1


def test_削除済みと同じ名前では作れない(admin: TestClient) -> None:
    admin.post("/api/v1/meta/objects", json=simple_table())
    admin.delete("/api/v1/meta/objects/projects")
    response = admin.post("/api/v1/meta/objects", json=simple_table())
    assert response.status_code == 400
    assert "元に戻すか" in response.json()["message"]


def test_新しいテーブルは活動の関連先にも加わる(admin: TestClient) -> None:
    admin.post("/api/v1/meta/objects", json=simple_table())
    activities = objects(admin)["activities"]
    related = next(f for f in activities["fields"] if f["type"] == "polymorphic")
    assert "projects" in related["targets"]


def test_サイドバーの並べ替え(admin: TestClient) -> None:
    keys = [o["key"] for o in meta(admin)["objects"]]
    response = admin.put("/api/v1/meta/objects/order", json={"keys": list(reversed(keys))})
    assert response.status_code == 200
    assert [o["key"] for o in response.json()["objects"]] == list(reversed(keys))


def test_ビューは誰でも作れて直せる(member: TestClient) -> None:
    body = {
        "object": "accounts",
        "type": "list",
        "name": "私の一覧",
        "config": {"columns": [{"field": "name", "width": 200}]},
    }
    response = member.post("/api/v1/meta/views", json=body)
    assert response.status_code == 200, response.text
    view = next(v for v in response.json()["views"] if v["name"] == "私の一覧")
    renamed = member.put(f"/api/v1/meta/views/{view['id']}", json={**body, "name": "直した"})
    assert renamed.status_code == 200
    assert any(v["name"] == "直した" for v in renamed.json()["views"])


def test_無い項目を指すビューは_400(admin: TestClient) -> None:
    body = {"object": "accounts", "type": "list", "name": "変", "config": {"columns": [{"field": "nope"}]}}
    assert admin.post("/api/v1/meta/views", json=body).status_code == 400
    kanban = {"object": "accounts", "type": "kanban", "name": "変", "config": {"group_by": "name", "card_fields": []}}
    assert admin.post("/api/v1/meta/views", json=kanban).status_code == 400


def test_ビューの削除と復元_最後の_1_枚は消せない(admin: TestClient) -> None:
    body = {
        "object": "accounts",
        "type": "list",
        "name": "消す用",
        "config": {"columns": [{"field": "name", "width": 200}]},
    }
    created = admin.post("/api/v1/meta/views", json=body).json()
    view = next(v for v in created["views"] if v["name"] == "消す用")
    assert admin.delete(f"/api/v1/meta/views/{view['id']}").status_code == 200
    assert admin.post(f"/api/v1/meta/views/{view['id']}/restore").status_code == 200
    # accounts のビューを 1 枚まで減らすと、最後の 1 枚は消せない
    mine = [v for v in meta(admin)["views"] if v["object"] == "accounts"]
    for extra in mine[1:]:
        admin.delete(f"/api/v1/meta/views/{extra['id']}")
    last = [v for v in meta(admin)["views"] if v["object"] == "accounts"]
    assert len(last) == 1
    response = admin.delete(f"/api/v1/meta/views/{last[0]['id']}")
    assert response.status_code == 400
    assert "最後のビュー" in response.json()["message"]


def test_タブの並べ替えは全部を渡す(admin: TestClient) -> None:
    ids = [v["id"] for v in meta(admin)["views"] if v["object"] == "tasks"]
    assert admin.put("/api/v1/meta/views/order", json={"object": "tasks", "ids": ids[:1]}).status_code == 400
    response = admin.put("/api/v1/meta/views/order", json={"object": "tasks", "ids": list(reversed(ids))})
    assert response.status_code == 200
    assert [v["id"] for v in response.json()["views"] if v["object"] == "tasks"] == list(reversed(ids))
