"""Google ドライブ(04 §8・J-035)。**本物の Google には繋がない** — `app.google.http.call` を偽物に差し替える。

偽物は「マイドライブ」を辞書で持ち、Drive API と同じ形で答える(作ったファイルは検索にも出る)。
表の行は SET-061・SET-062・SET-063(`docs/tests/settings.md` §4)。
"""

import base64
import json
from collections.abc import Callable, Iterator
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.google import drive, oauth

Make = Callable[..., str]

DOCUMENT = "application/vnd.google-apps.document"
FOLDER = "application/vnd.google-apps.folder"


def _id_token(email: str) -> str:
    """Google が token の応答に入れてくる id_token の形(署名は使わないので中身だけ本物に似せる)。"""
    body = base64.urlsafe_b64encode(json.dumps({"email": email}).encode()).decode().rstrip("=")
    return f"header.{body}.signature"


class FakeGoogle:
    """マイドライブの偽物。呼ばれた要求を全部覚えておき、テストから見られるようにする。"""

    def __init__(self) -> None:
        self.files: list[dict[str, str]] = []
        self.calls: list[dict[str, Any]] = []
        self.access_token = "access-1"
        self.refresh_token: str | None = "refresh-1"
        self.email = "takuya@example.jp"
        self.seq = 0

    def add(self, name: str, mime: str = DOCUMENT, parent: str = "root") -> dict[str, str]:
        self.seq += 1
        file = {
            "id": f"file-{self.seq}",
            "name": name,
            "mimeType": mime,
            "webViewLink": f"https://docs.google.com/document/d/file-{self.seq}/edit",
            "parent": parent,
        }
        self.files.append(file)
        return file

    def _search(self, q: str) -> list[dict[str, str]]:
        hits = []
        for file in self.files:
            if "trashed = false" in q and f"mimeType = '{FOLDER}'" in q and file["mimeType"] != FOLDER:
                continue
            if f"mimeType != '{FOLDER}'" in q and file["mimeType"] == FOLDER:
                continue
            if "name contains '" in q and q.split("name contains '")[1].split("'")[0] not in file["name"]:
                continue
            if "name = '" in q and q.split("name = '")[1].split("'")[0] != file["name"]:
                continue
            if "' in parents" in q and q.split("'")[-2] != file["parent"]:
                continue
            hits.append(file)
        return hits

    def call(self, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
        self.calls.append({"method": method, "url": url, **kwargs})
        data = kwargs.get("data") or {}
        params = kwargs.get("params") or {}
        body = kwargs.get("json") or {}

        if url == oauth.TOKEN_URL:
            payload: dict[str, Any] = {
                "access_token": self.access_token,
                "expires_in": 3600,
                "scope": " ".join(oauth.SCOPES),
            }
            if data.get("grant_type") == "authorization_code":
                payload["id_token"] = _id_token(self.email)
                if self.refresh_token:
                    payload["refresh_token"] = self.refresh_token
            return payload
        if url == oauth.REVOKE_URL:
            return {}
        if url == drive.FILES_URL and method == "GET":
            hits = self._search(str(params.get("q", "")))[: int(params.get("pageSize", 20))]
            return {"files": [{k: v for k, v in f.items() if k != "parent"} for f in hits]}
        if url == drive.FILES_URL and method == "POST":
            parents = body.get("parents") or ["root"]
            return self.add(str(body["name"]), str(body.get("mimeType", DOCUMENT)), parent=str(parents[0]))
        raise AssertionError(f"偽物が知らない呼び出し: {method} {url}")


@pytest.fixture
def google(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeGoogle]:
    fake = FakeGoogle()
    monkeypatch.setattr("app.google.http.call", fake.call)
    # OAuth クライアントがある状態にする。**署名の鍵(WORKS_SECRET_KEY)は触らない** —
    # 途中で変えると、ログイン済みの Cookie も state も読めなくなる
    monkeypatch.setenv("WORKS_GOOGLE_CLIENT_ID", "client-id.apps.googleusercontent.com")
    monkeypatch.setenv("WORKS_GOOGLE_CLIENT_SECRET", "client-secret")
    get_settings.cache_clear()
    yield fake
    get_settings.cache_clear()


def connect(client: TestClient) -> None:
    """画面と同じ順で繋ぐ: 許可の URL をもらう → Google から戻る。"""
    url = client.post("/api/v1/google/connect").json()["url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    done = client.get("/api/v1/google/callback", params={"code": "auth-code", "state": state}, follow_redirects=False)
    assert done.status_code == 303, done.text


def test_繋ぐと状態に_Google_のアドレスが出る(admin: TestClient, google: FakeGoogle) -> None:
    before = admin.get("/api/v1/google/status").json()
    assert before == {"connected": False, "email": None, "configured": True}

    connect(admin)
    assert admin.get("/api/v1/google/status").json() == {
        "connected": True,
        "email": "takuya@example.jp",
        "configured": True,
    }
    # 外すと消える(ファイルは消さない)
    assert admin.delete("/api/v1/google/connection").status_code == 204
    assert admin.get("/api/v1/google/status").json()["connected"] is False


def test_許可の_URL_は_PKCE_と_オフラインを含む(admin: TestClient, google: FakeGoogle) -> None:
    query = parse_qs(urlparse(admin.post("/api/v1/google/connect").json()["url"]).query)
    assert query["code_challenge_method"] == ["S256"]
    assert query["access_type"] == ["offline"]
    assert query["prompt"] == ["consent"]
    assert "https://www.googleapis.com/auth/drive.readonly" in query["scope"][0]


def test_偽の_state_では繋がらない(admin: TestClient, google: FakeGoogle) -> None:
    url = admin.post("/api/v1/google/connect").json()["url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    # 署名を 1 文字変えたものは拒む(画面へは「失敗」として戻す)
    tampered = state[:-1] + ("0" if state[-1] != "0" else "1")
    back = admin.get("/api/v1/google/callback", params={"code": "x", "state": tampered}, follow_redirects=False)
    assert back.status_code == 303
    assert back.headers["location"].endswith("google=error")
    assert admin.get("/api/v1/google/status").json()["connected"] is False


def test_許可を断られたら画面へ理由を返す(admin: TestClient, google: FakeGoogle) -> None:
    back = admin.get("/api/v1/google/callback", params={"error": "access_denied"}, follow_redirects=False)
    assert back.status_code == 303
    assert back.headers["location"].endswith("google=denied")


def test_繋いでいなければドライブは_409(admin: TestClient, google: FakeGoogle) -> None:
    res = admin.get("/api/v1/drive/files")
    assert res.status_code == 409
    assert res.json()["code"] == "google_reauth"


def test_設定が無ければドライブは_503(admin: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WORKS_GOOGLE_CLIENT_ID", "")
    monkeypatch.setenv("WORKS_GOOGLE_CLIENT_SECRET", "")
    get_settings.cache_clear()
    try:
        res = admin.get("/api/v1/drive/files")
        assert res.status_code == 503
        assert res.json()["code"] == "google_not_configured"
        assert admin.get("/api/v1/google/status").json()["configured"] is False
    finally:
        get_settings.cache_clear()


def test_access_token_は控えを使い回す(admin: TestClient, google: FakeGoogle) -> None:
    connect(admin)
    admin.get("/api/v1/drive/files")
    admin.get("/api/v1/drive/files")
    # 繋いだときの 1 回だけ。2 回目以降は控えの access token を使う(切れるまで取り直さない)
    assert sum(1 for c in google.calls if c["url"] == oauth.TOKEN_URL) == 1


def test_鍵は暗号化して持つ(admin: TestClient, google: FakeGoogle, conn: Any) -> None:
    from sqlalchemy import select

    from app.google.store import decrypt
    from app.meta.tables import google_accounts

    connect(admin)
    row = conn.execute(select(google_accounts)).one()
    assert row.refresh_token != "refresh-1"  # そのままは入っていない
    assert decrypt(row.refresh_token) == "refresh-1"


def test_SET_063_参照はマイドライブを名前で探して_20_件まで(admin: TestClient, google: FakeGoogle) -> None:
    connect(admin)
    for i in range(25):
        google.add(f"見積書テンプレート {i}")
    google.add("会社案内")

    hits = admin.get("/api/v1/drive/files", params={"q": "テンプレート"}).json()
    assert len(hits) == 20
    assert all("テンプレート" in f["name"] for f in hits)
    assert hits[0] == {
        "id": hits[0]["id"],
        "name": hits[0]["name"],
        "mime_type": DOCUMENT,
        "url": f"https://docs.google.com/document/d/{hits[0]['id']}/edit",
    }
    # 空なら全部(ただし 20 件まで)。フォルダとゴミ箱は出さない
    assert len(admin.get("/api/v1/drive/files").json()) == 20
    sent = [c for c in google.calls if c["url"] == drive.FILES_URL and c["method"] == "GET"][-1]
    assert sent["params"]["pageSize"] == 20
    assert f"mimeType != '{FOLDER}'" in sent["params"]["q"]
    assert "trashed = false" in sent["params"]["q"]


def test_SET_061_新規はレコード名のドキュメントを作って末尾に足す(
    admin: TestClient, google: FakeGoogle, make: Make
) -> None:
    connect(admin)
    existing = {
        "id": "file-old",
        "name": "前からある資料",
        "mime_type": "application/pdf",
        "url": "https://drive.google.com/file/d/file-old/view",
    }
    opportunity = make(
        "opportunities", name="アオバ精機 保守契約", documents=json.dumps([existing], ensure_ascii=False)
    )

    res = admin.post(f"/api/v1/objects/opportunities/records/{opportunity}/drive/documents/document")
    assert res.status_code == 200, res.text
    files = json.loads(res.json()["record"]["documents"])
    assert [f["name"] for f in files] == ["前からある資料", "アオバ精機 保守契約"]
    assert files[-1]["mime_type"] == DOCUMENT

    # マイドライブ / CRM / 商談 の中に置く(フォルダが無ければ作る)
    made = [c for c in google.calls if c["method"] == "POST" and c["url"] == drive.FILES_URL]
    assert [c["json"]["name"] for c in made] == ["CRM", "商談", "アオバ精機 保守契約"]
    assert [c["json"]["mimeType"] for c in made] == [FOLDER, FOLDER, DOCUMENT]
    # 作ったものは「参照」でも見つかる
    assert any(f["name"] == "アオバ精機 保守契約" for f in admin.get("/api/v1/drive/files").json())

    # 2 回目はフォルダを作り直さない(あるものを使う)
    google.calls.clear()
    admin.post(f"/api/v1/objects/opportunities/records/{opportunity}/drive/documents/document")
    again = [c for c in google.calls if c["method"] == "POST" and c["url"] == drive.FILES_URL]
    assert [c["json"]["mimeType"] for c in again] == [DOCUMENT]


def test_SET_062_ドライブ型でない項目は_400_無いレコードは_404(
    admin: TestClient, google: FakeGoogle, make: Make
) -> None:
    connect(admin)
    opportunity = make("opportunities", name="商談")

    wrong = admin.post(f"/api/v1/objects/opportunities/records/{opportunity}/drive/name/document")
    assert wrong.status_code == 400
    assert wrong.json()["code"] == "invalid"

    missing = "09000000-0000-7000-8000-0000000000ff"
    assert admin.post(f"/api/v1/objects/opportunities/records/{missing}/drive/documents/document").status_code == 404
