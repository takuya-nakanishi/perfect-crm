"""Works の JSON API。契約は docs/design/04、振る舞いの正は frontend/src/mocks。"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from starlette.applications import Starlette
from starlette.types import Receive, Scope, Send

from app.api import account, google, meta, oauth, records, session, settings, slack, workflows
from app.auth import oidc
from app.config import get_settings
from app.errors import install_error_handlers
from app.mcpserver import server as mcp_server
from app.workflows import runner

# MCP(03 §6)。`/mcp` と OAuth の口は、下の API より後ろに丸ごと載せる(API の道が先に当たる)。
# SDK の接続管理は 1 回しか起動できないので、起動(lifespan)のたびに作り直す(本番は 1 回、テストはクライアントごと)
_mcp: dict[str, Starlette] = {}


async def mcp_asgi(scope: Scope, receive: Receive, send: Send) -> None:
    await _mcp["app"](scope, receive, send)


def check_settings() -> None:
    """公開する場所(https)では、WORKS_SECRET_KEY は必須(03 §5)。

    空だと起動ごとに鍵が変わり、2 段階認証の秘密・Google と Slack の鍵を読めなくなる。黙って動かさずに止める。
    Microsoft でログインの設定は、片方だけ・読めない証明書なら止める(ボタンが出ているのに入れない、を作らない)。
    """
    s = get_settings()
    if s.secure_cookie and not s.secret_key:
        raise RuntimeError("WORKS_SECRET_KEY が空です。.env に入れてから起動してください(docs/runbook/01 §6 の A)")
    if s.microsoft_client_id or s.microsoft_certificate:
        if not s.microsoft_enabled:
            raise RuntimeError(
                "WORKS_MICROSOFT_CLIENT_ID と WORKS_MICROSOFT_CERTIFICATE は両方要ります(docs/runbook/01 §6c)"
            )
        oidc.check_credential()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    check_settings()
    server = mcp_server.build()
    _mcp["app"] = mcp_server.asgi_app(server)
    # ワークフローの送り係(04 §15)。テストは起こさない(WORKS_WORKFLOW_RUNNER=false)
    runner.start()
    try:
        async with server.session_manager.run():
            yield
    finally:
        runner.stop()


app = FastAPI(
    lifespan=lifespan,
    title="Works API",
    version="0.1.0",
    docs_url="/api/v1/docs",
    openapi_url="/api/v1/openapi.json",
    redoc_url=None,
)
install_error_handlers(app)

v1 = APIRouter(prefix="/api/v1")
v1.include_router(session.router)
v1.include_router(account.router)
v1.include_router(meta.router)
v1.include_router(records.router)
v1.include_router(settings.router)
v1.include_router(google.router)
v1.include_router(slack.router)
v1.include_router(workflows.router)
v1.include_router(oauth.router)
app.include_router(v1)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


app.mount("/", mcp_asgi)
