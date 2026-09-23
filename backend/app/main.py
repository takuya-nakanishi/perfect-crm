"""Works の JSON API。契約は docs/design/04、振る舞いの正は frontend/src/mocks。"""

from fastapi import APIRouter, FastAPI

from app.api import meta, records, session, settings
from app.errors import install_error_handlers

app = FastAPI(
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
app.include_router(v1)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
