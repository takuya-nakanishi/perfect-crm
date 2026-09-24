"""MCP と、Claude のカスタムコネクタが通る OAuth(03 §6・04 §13・J-028)。

Claude が実際にたどる順(登録 → /authorize → 画面で本人が許可 → /token → /mcp → refresh)を、そのまま通す。
MCP の Host の検査があるので、宛先は公開 URL(テストでは既定の http://127.0.0.1:8610)で書く。
"""

import base64
import hashlib
import secrets
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from mcp_types import LATEST_PROTOCOL_VERSION

BASE = "http://127.0.0.1:8610"
MCP = f"{BASE}/mcp"
CALLBACK = "https://claude.ai/api/mcp/auth_callback"
MCP_HEADERS = {"Accept": "application/json, text/event-stream", "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION}


def _register(client: TestClient, redirect: str = CALLBACK) -> Any:
    return client.post(
        f"{BASE}/register",
        json={
            "redirect_uris": [redirect],
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "client_name": "Claude",
        },
    )


def _authorize(client: TestClient, client_id: str) -> tuple[str, str]:
    """/authorize → 許可の画面の依頼 ID と、PKCE の verifier。"""
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    response = client.get(
        f"{BASE}/authorize",
        params={
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": CALLBACK,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": "st-1",
            "scope": "works",
            "resource": MCP,
        },
        follow_redirects=False,
    )
    assert response.status_code == 302, response.text
    location = urlparse(response.headers["location"])
    assert location.path == "/oauth/consent"
    return parse_qs(location.query)["request"][0], verifier


def _connect(admin: TestClient) -> dict[str, Any]:
    """本人が許可して、トークンまで取る。"""
    client_id = _register(admin).json()["client_id"]
    request_id, verifier = _authorize(admin, client_id)
    redirect = admin.post(f"/api/v1/oauth/requests/{request_id}", json={"approve": True}).json()["redirect_url"]
    query = parse_qs(urlparse(redirect).query)
    assert redirect.startswith(CALLBACK) and query["state"] == ["st-1"]
    token = admin.post(
        f"{BASE}/token",
        data={
            "grant_type": "authorization_code",
            "code": query["code"][0],
            "redirect_uri": CALLBACK,
            "client_id": client_id,
            "code_verifier": verifier,
            "resource": MCP,
        },
    )
    assert token.status_code == 200, token.text
    return {"client_id": client_id, "code": query["code"][0], "verifier": verifier, **token.json()}


def _rpc(
    client: TestClient,
    token: str,
    method: str,
    params: dict[str, Any] | None = None,
    version: str = LATEST_PROTOCOL_VERSION,
) -> Any:
    body = dict(params or {})
    headers = {**MCP_HEADERS, "MCP-Protocol-Version": version, "Authorization": f"Bearer {token}"}
    if version == LATEST_PROTOCOL_VERSION:
        # 最新の版は状態を持たず、毎回の呼び出しに版とクライアントの能力を添える。
        # 経路の見分けのため、メソッド名(と tools/call ならツール名)をヘッダにも写す
        body["_meta"] = {
            "io.modelcontextprotocol/protocolVersion": version,
            "io.modelcontextprotocol/clientCapabilities": {},
        }
        headers["Mcp-Method"] = method
        if method == "tools/call":
            headers["Mcp-Name"] = body["name"]
    response = client.post(
        MCP,
        headers=headers,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": body},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _tool(client: TestClient, token: str, name: str, **arguments: Any) -> Any:
    return _rpc(client, token, "tools/call", {"name": name, "arguments": arguments})["result"]


def test_メタデータで認可サーバと資源の場所が分かる(client: TestClient) -> None:
    resource = client.get(f"{BASE}/.well-known/oauth-protected-resource/mcp").json()
    assert resource["resource"] == MCP
    assert resource["authorization_servers"] == [f"{BASE}/"]
    server = client.get(f"{BASE}/.well-known/oauth-authorization-server").json()
    assert server["registration_endpoint"] == f"{BASE}/register"
    assert server["code_challenge_methods_supported"] == ["S256"]


def test_トークンが無ければ_401_で_メタデータの場所を教える(client: TestClient) -> None:
    response = client.post(MCP, headers=MCP_HEADERS, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert response.status_code == 401
    assert "resource_metadata=" in response.headers["www-authenticate"]


@pytest.mark.parametrize(
    "redirect",
    ["https://evil.example.com/callback", "http://localhost:5000/other", "https://claude.ai/other"],
)
def test_Claude_以外の戻り先では登録できない(client: TestClient, redirect: str) -> None:
    response = _register(client, redirect)
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_redirect_uri"


def test_Claude_Code_の_loopback_は登録できる(client: TestClient) -> None:
    assert _register(client, "http://127.0.0.1:43127/callback").status_code == 201


def test_許可の画面には_アプリ名と戻り先のホストが出る(admin: TestClient) -> None:
    request_id, _ = _authorize(admin, _register(admin).json()["client_id"])
    body = admin.get(f"/api/v1/oauth/requests/{request_id}").json()
    assert body == {"id": request_id, "client_name": "Claude", "redirect_host": "claude.ai", "scopes": ["works"]}


def test_断ると_access_denied_で戻る(admin: TestClient) -> None:
    request_id, _ = _authorize(admin, _register(admin).json()["client_id"])
    redirect = admin.post(f"/api/v1/oauth/requests/{request_id}", json={"approve": False}).json()["redirect_url"]
    assert parse_qs(urlparse(redirect).query)["error"] == ["access_denied"]
    # 1 回きり
    assert admin.post(f"/api/v1/oauth/requests/{request_id}", json={"approve": True}).status_code == 404


def test_未ログインでは許可できない(client: TestClient) -> None:
    request_id, _ = _authorize(client, _register(client).json()["client_id"])
    assert client.post(f"/api/v1/oauth/requests/{request_id}", json={"approve": True}).status_code == 401


def test_許可すると_その利用者として_MCP_で読み書きできる(admin: TestClient) -> None:
    token = _connect(admin)["access_token"]
    names = {t["name"] for t in _rpc(admin, token, "tools/list")["result"]["tools"]}
    assert names == {"list_tables", "search", "list_records", "get_record", "create_record", "update_record"}

    tables = _tool(admin, token, "list_tables")["structuredContent"]["result"]
    assert "tasks" in {t["key"] for t in tables}

    created = _tool(admin, token, "create_record", table="tasks", values={"title": "MCP から足したタスク"})
    record = created["structuredContent"]["record"]
    assert record["title"] == "MCP から足したタスク"
    # 画面と同じ既定値(担当は自分)が入る = 同じ経路を通っている
    assert record["assignee_id"] == "09000000-0000-7000-8000-000000000001"

    done = _tool(admin, token, "update_record", table="tasks", id=record["id"], values={"status": "done"})
    assert done["structuredContent"]["record"]["completed_at"] is not None


def test_ひとつ前の版_initialize_から始める形_でも使える(admin: TestClient) -> None:
    token = _connect(admin)["access_token"]
    old = "2025-11-25"
    info = {"name": "claude", "version": "1"}
    init = _rpc(admin, token, "initialize", {"protocolVersion": old, "capabilities": {}, "clientInfo": info}, old)
    assert init["result"]["serverInfo"]["name"] == "Works"
    assert init["result"]["protocolVersion"] == old
    assert len(_rpc(admin, token, "tools/list", version=old)["result"]["tools"]) == 6


def test_検証の失敗は理由付きのツールのエラーで返る(admin: TestClient) -> None:
    token = _connect(admin)["access_token"]
    result = _tool(admin, token, "create_record", table="tasks", values={"no_such_column": 1})
    assert result["isError"] is True
    assert "no_such_column" in result["content"][0]["text"]


def test_認可コードは_1_回しか使えない(admin: TestClient) -> None:
    got = _connect(admin)
    again = admin.post(
        f"{BASE}/token",
        data={
            "grant_type": "authorization_code",
            "code": got["code"],
            "redirect_uri": CALLBACK,
            "client_id": got["client_id"],
            "code_verifier": got["verifier"],
        },
    )
    assert again.status_code == 400
    assert again.json()["error"] == "invalid_grant"


def test_refresh_で新しい組に替わり_古い_refresh_は使えない(admin: TestClient) -> None:
    got = _connect(admin)
    body = {"grant_type": "refresh_token", "refresh_token": got["refresh_token"], "client_id": got["client_id"]}
    fresh = admin.post(f"{BASE}/token", data=body)
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["refresh_token"] != got["refresh_token"]
    assert _rpc(admin, fresh.json()["access_token"], "tools/list")["result"]["tools"]
    reused = admin.post(f"{BASE}/token", data=body)
    assert reused.status_code == 400
    assert reused.json()["error"] == "invalid_grant"


def test_接続を切ると_次の呼び出しから_401(admin: TestClient) -> None:
    token = _connect(admin)["access_token"]
    connections = admin.get("/api/v1/settings/mcp/connections").json()
    assert connections[0]["client_name"] == "Claude"
    assert connections[0]["last_used_at"] is None
    _rpc(admin, token, "tools/list")
    assert admin.get("/api/v1/settings/mcp/connections").json()[0]["last_used_at"] is not None

    assert admin.delete(f"/api/v1/settings/mcp/connections/{connections[0]['id']}").status_code == 204
    response = admin.post(MCP, headers={**MCP_HEADERS, "Authorization": f"Bearer {token}"}, json={"jsonrpc": "2.0"})
    assert response.status_code == 401


def test_管理者でなければ接続の一覧は見られない(member: TestClient) -> None:
    assert member.get("/api/v1/settings/mcp/connections").status_code == 403


def test_環境設定で発行したトークンでも_MCP_を使える(admin: TestClient) -> None:
    secret = admin.post("/api/v1/settings/mcp/tokens", json={"name": "Codex", "client": "codex"}).json()["secret"]
    assert _rpc(admin, secret, "tools/list")["result"]["tools"]
    bad = admin.post(MCP, headers={**MCP_HEADERS, "Authorization": "Bearer wks_nothing"}, json={"jsonrpc": "2.0"})
    assert bad.status_code == 401
