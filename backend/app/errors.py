"""API のエラー。契約は docs/design/04 §1 — HTTP ステータス + {"code", "message"}。"""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    """画面・MCP・取り込みのどこから来ても同じ形で返すための例外。"""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def bad_request(message: str, code: str = "invalid") -> ApiError:
    return ApiError(400, code, message)


def too_many_requests(message: str = "送信が多すぎます。少し待ってからもう一度お試しください") -> ApiError:
    return ApiError(429, "too_many_requests", message)


def unauthorized(message: str = "ログインしていません") -> ApiError:
    return ApiError(401, "unauthorized", message)


def forbidden(message: str = "この操作は管理者だけができます") -> ApiError:
    return ApiError(403, "forbidden", message)


def not_found(message: str = "見つかりません") -> ApiError:
    return ApiError(404, "not_found", message)


def conflict(message: str, code: str) -> ApiError:
    """いまのデータの状態のせいで、その操作ができない(必須の参照で使われているレコードの削除など)。"""
    return ApiError(409, code, message)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status, content={"code": exc.code, "message": exc.message})

    @app.exception_handler(RequestValidationError)
    def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Pydantic の検証も、契約どおり 400 + {code, message} に揃える(FastAPI の既定は 422)
        first: dict[str, Any] = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", ()) if p not in ("body", "query", "path"))
        detail = first.get("msg", "入力が正しくありません")
        message = f"{where}: {detail}" if where else str(detail)
        return JSONResponse(status_code=400, content={"code": "invalid", "message": message})
