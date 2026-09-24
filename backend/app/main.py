"""Works の JSON API。契約は docs/design/04、振る舞いの正は frontend/src/mocks。"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from starlette.applications import Starlette
from starlette.types import Receive, Scope, Send

from app.api import google, meta, oauth, records, session, settings
from app.errors import install_error_handlers
from app.mcpserver import server as mcp_server

# MCP(03 §6)。`/mcp` と OAuth の口は、下の API より後ろに丸ごと載せる(API の道が先に当たる)。
# SDK の接続管理は 1 回しか起動できないので、起動(lifespan)のたびに作り直す(本番は 1 回、テストはクライアントごと)
_mcp: dict[str, Starlette] = {}


async def mcp_asgi(scope: Scope, receive: Receive, send: Send) -> None:
    await _mcp["app"](scope, receive, send)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    server = mcp_server.build()
    _mcp["app"] = mcp_server.asgi_app(server)
    async with server.session_manager.run():
        yield


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
v1.include_router(meta.router)
v1.include_router(records.router)
v1.include_router(settings.router)
v1.include_router(google.router)
v1.include_router(oauth.router)
app.include_router(v1)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


app.mount("/", mcp_asgi)
