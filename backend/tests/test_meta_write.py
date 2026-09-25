"""テーブル設定とビューの書き込み(04 §6、決まりは 02 §5)。管理者の制限は 03 §5。"""

import uuid
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


def test_META_097_文字の項目を外すと検索に当たらず_戻せばまた当たる(admin: TestClient) -> None:
    with_memo = simple_table()
    with_memo["fields"].append({"key": "memo", "label": "メモ", "type": "text"})
    admin.post("/api/v1/meta/objects", json=with_memo)
    record = admin.post("/api/v1/objects/projects/records", json={"name": "案件", "memo": "かささぎ"}).json()["record"]

    def listed() -> int:
        return admin.post("/api/v1/objects/projects/records/query", json={"q": "カササギ"}).json()["total"]

    def searched() -> list[str]:
        hits = admin.get("/api/v1/search", params={"q": "カササギ"}).json()["hits"]
        return [h["id"] for h in hits if h["object"] == "projects"]

    assert listed() == 1 and searched() == [record["id"]]
    # メモを外す → 値は残るが、どちらの検索にも当たらない。値は変わらないので更新日時も動かない
    assert admin.put("/api/v1/meta/objects/projects", json=simple_table()).status_code == 200
    assert listed() == 0 and searched() == []
    after = admin.get(f"/api/v1/objects/projects/records/{record['id']}").json()["record"]
    assert after["updated_at"] == record["updated_at"]
    # 同じ列名で戻す → また当たる
    assert admin.put("/api/v1/meta/objects/projects", json=with_memo).status_code == 200
    assert listed() == 1 and searched() == [record["id"]]


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


# --- サイドバーの並びとフォルダ(PUT /meta/sidebar。05 §13) ---------------------------------

SALES = "0199a000-0000-7000-8000-00000000a001"
PROJECTS = "0199a000-0000-7000-8000-00000000a002"


def sidebar(client: TestClient) -> list[dict[str, Any]]:
    """GET /meta から組んだサイドバーの並び(画面の `sidebarItems` と同じ規則。同じ番号ならフォルダが先)。"""
    body = meta(client)
    folders = sorted(body["folders"], key=lambda f: f["position"])
    ids = {f["id"] for f in folders}
    objects = sorted(body["objects"], key=lambda o: o["position"])
    top: list[tuple[int, dict[str, Any]]] = [
        (
            f["position"],
            {
                "type": "folder",
                "id": f["id"],
                "label": f["label"],
                "keys": [o["key"] for o in objects if o.get("folder_id") == f["id"]],
            },
        )
        for f in folders
    ]
    top += [(o["position"], {"type": "object", "key": o["key"]}) for o in objects if o.get("folder_id") not in ids]
    return [item for _, item in sorted(top, key=lambda t: t[0])]


def ordered_keys(client: TestClient) -> list[str]:
    return [o["key"] for o in sorted(meta(client)["objects"], key=lambda o: o["position"])]


def test_META_024_並びに無いテーブルは元の順で後ろ_無いテーブルは_400(admin: TestClient) -> None:
    keys = ordered_keys(admin)
    picked = list(reversed(keys[:3]))
    response = admin.put("/api/v1/meta/sidebar", json={"items": [{"type": "object", "key": k} for k in picked]})
    assert response.status_code == 200, response.text
    after = sorted(response.json()["objects"], key=lambda o: o["position"])
    assert [o["key"] for o in after] == [*picked, *[k for k in keys if k not in picked]]
    # 1 から詰めて振り直す
    assert [o["position"] for o in after] == list(range(1, len(after) + 1))
    # 無いテーブル・削除中のテーブルを含めれば 400 で、並びは変わらない
    current = ordered_keys(admin)
    bad = admin.put("/api/v1/meta/sidebar", json={"items": [{"type": "object", "key": "no_such_table"}]})
    assert bad.status_code == 400
    assert admin.post("/api/v1/meta/objects", json=simple_table()).status_code == 200
    assert admin.delete("/api/v1/meta/objects/projects").status_code == 200
    trashed = admin.put("/api/v1/meta/sidebar", json={"items": [{"type": "object", "key": "projects"}]})
    assert trashed.status_code == 400
    assert ordered_keys(admin) == current


def test_META_115_フォルダを作ると中のテーブルに_folder_id_が付き_通し番号になる(admin: TestClient) -> None:
    inside = ["accounts", "contacts", "opportunities"]
    rest = [i for i in sidebar(admin) if i["type"] != "object" or i["key"] not in inside]
    items = [{"type": "folder", "id": SALES, "label": " 営業 ", "keys": inside}, *rest]
    response = admin.put("/api/v1/meta/sidebar", json={"items": items})
    assert response.status_code == 200, response.text
    body = response.json()
    # 名前の前後の空白は落とす
    assert body["folders"] == [{"id": SALES, "label": "営業", "position": 1}]
    at = {o["key"]: (o["position"], o.get("folder_id")) for o in body["objects"]}
    assert [at[k] for k in inside] == [(2, SALES), (3, SALES), (4, SALES)]
    # フォルダの外のテーブルは folder_id を持たず、中身の後ろから続く
    assert at["tasks"] == (5, None)
    assert at["activities"] == (6, None)
    assert sidebar(admin) == [{**items[0], "label": "営業"}, *rest]
    # 同じ id のまま名前を変える(フォルダは増えない)
    renamed = [{**items[0], "label": "営業部"}, *rest]
    assert admin.put("/api/v1/meta/sidebar", json={"items": renamed}).status_code == 200
    assert meta(admin)["folders"] == [{"id": SALES, "label": "営業部", "position": 1}]


def test_META_116_本文から外したフォルダは消え_送り直すと同じ_id_で戻る(admin: TestClient) -> None:
    assert admin.post("/api/v1/meta/objects", json=simple_table("dreams")).status_code == 200
    base = [i for i in sidebar(admin) if i["type"] != "object" or i["key"] not in ("dreams", "tasks")]
    folder = {"type": "folder", "id": PROJECTS, "label": "プロジェクト", "keys": ["dreams", "tasks"]}
    assert admin.put("/api/v1/meta/sidebar", json={"items": [*base, folder]}).status_code == 200
    # 中のテーブルを 1 つ削除しておく(削除中も folder_id を持ったまま)
    assert admin.delete("/api/v1/meta/objects/dreams").status_code == 200
    before = sidebar(admin)
    assert before[-1] == {**folder, "keys": ["tasks"]}

    # フォルダを消す: 中のテーブルはその場所へ出て、folder_id が外れる
    removed = [*before[:-1], {"type": "object", "key": "tasks"}]
    assert admin.put("/api/v1/meta/sidebar", json={"items": removed}).status_code == 200
    body = meta(admin)
    assert body["folders"] == []
    assert "folder_id" not in next(o for o in body["objects"] if o["key"] == "tasks")
    # 削除中だったテーブルも、消えたフォルダを指さない(戻すとフォルダの外)
    assert admin.post("/api/v1/meta/objects/dreams/restore").status_code == 200
    assert "folder_id" not in next(o for o in meta(admin)["objects"] if o["key"] == "dreams")

    # 元に戻す: 消す前の並びを送り直すと、同じ id・同じ名前のフォルダに、同じ中身が戻る
    assert admin.put("/api/v1/meta/sidebar", json={"items": before}).status_code == 200
    body = meta(admin)
    assert [(f["id"], f["label"]) for f in body["folders"]] == [(PROJECTS, "プロジェクト")]
    assert [o["key"] for o in body["objects"] if o.get("folder_id") == PROJECTS] == ["tasks"]


def test_META_117_名前が空_id_が_UUID_でない_重複は_400(admin: TestClient) -> None:
    before = meta(admin)
    items = sidebar(admin)

    def folder(**patch: Any) -> dict[str, Any]:
        return {"type": "folder", "id": str(uuid.uuid4()), "label": "営業", "keys": [], **patch}

    cases = {
        "空の名前": [folder(label="  "), *items],
        "UUID でない id": [folder(id="sales"), *items],
        "同じフォルダが 2 回": [folder(id=SALES), folder(id=SALES), *items],
        "大文字でも同じフォルダ": [folder(id=SALES.upper()), folder(id=SALES), *items],
        "同じテーブルが 2 回": [folder(keys=["accounts"]), *items],
        "形が違う": [{"type": "nope"}, *items],
    }
    for name, body in cases.items():
        response = admin.put("/api/v1/meta/sidebar", json={"items": body})
        assert response.status_code == 400, name
        assert response.json()["code"] == "invalid", name
    assert meta(admin) == before
    # 対照: 正しい形なら通る
    assert admin.put("/api/v1/meta/sidebar", json={"items": [folder(), *items]}).status_code == 200
    assert len(meta(admin)["folders"]) == 1


def test_META_118_フォルダがあっても作ったテーブルは末尾でフォルダの外(admin: TestClient) -> None:
    items = [*sidebar(admin), {"type": "folder", "id": PROJECTS, "label": "末尾のフォルダ", "keys": []}]
    assert admin.put("/api/v1/meta/sidebar", json={"items": items}).status_code == 200
    body = admin.post("/api/v1/meta/objects", json=simple_table()).json()
    made = next(o for o in body["objects"] if o["key"] == "projects")
    assert "folder_id" not in made
    assert made["position"] > body["folders"][0]["position"]
    assert sidebar(admin)[-1] == {"type": "object", "key": "projects"}


def test_管理者でなければサイドバーを保存できない(member: TestClient) -> None:
    items = [{"type": "folder", "id": SALES, "label": "営業", "keys": []}, *sidebar(member)]
    response = member.put("/api/v1/meta/sidebar", json={"items": items})
    assert response.status_code == 403
    assert meta(member)["folders"] == []


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
