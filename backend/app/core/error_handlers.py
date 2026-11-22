from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import settings
from app.core.exceptions import AppError
from app.core.logging_config import get_logger, request_id_ctx

logger = get_logger("error_handler")


def _base_headers(request_id: str) -> dict[str, str]:
    return {
        "X-Request-ID": request_id,
        "Access-Control-Allow-Origin": settings.FRONTEND_URL,
        "Access-Control-Allow-Credentials": "true",
    }


def _error_payload(status_code: int, code: str, message: str, request_id: str, details: dict | None = None) -> dict:
    body = {
        "detail": message,
        "error": {
            "codigo": code,
            "mensaje": message,
            "status": status_code,
        },
        "requestId": request_id,
    }
    if details:
        body["error"]["detalles"] = details
    return body


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError):
        req_id = getattr(request.state, "request_id", request_id_ctx.get())
        log_method = logger.error if exc.status_code >= 500 else logger.warning
        log_method(
            "error_controlado",
            extra={
                "evento": "error_controlado",
                "codigo": exc.code,
                "status": exc.status_code,
                "metodo": request.method,
                "ruta": request.url.path,
                "error": exc.message,
                "detalles": exc.details,
                "requestId": req_id,
            },
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_payload(exc.status_code, exc.code, exc.message, req_id, exc.details),
            headers=_base_headers(req_id),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError):
        req_id = getattr(request.state, "request_id", request_id_ctx.get())
        campos = [
            {
                "campo": ".".join(str(loc) for loc in err.get("loc", [])),
                "motivo": err.get("msg", "valor inválido"),
            }
            for err in exc.errors()
        ]
        logger.warning(
            "validacion_fallida",
            extra={
                "evento": "validacion_fallida",
                "status": 400,
                "metodo": request.method,
                "ruta": request.url.path,
                "campos": campos,
                "requestId": req_id,
            },
        )
        return JSONResponse(
            status_code=400,
            content=_error_payload(
                400,
                "VALIDACION_FALLIDA",
                "Los datos enviados no son válidos. Revisa los parámetros de tu solicitud.",
                req_id,
                {"campos": campos},
            ),
            headers=_base_headers(req_id),
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        req_id = getattr(request.state, "request_id", request_id_ctx.get())
        msg = exc.detail if isinstance(exc.detail, str) else "Error en la solicitud HTTP."
        code = "RECURSO_NO_ENCONTRADO" if exc.status_code == 404 else f"HTTP_{exc.status_code}"
        log_method = logger.error if exc.status_code >= 500 else logger.warning
        log_method(
            "http_error",
            extra={
                "evento": "http_error",
                "status": exc.status_code,
                "metodo": request.method,
                "ruta": request.url.path,
                "error": msg,
                "requestId": req_id,
            },
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_payload(exc.status_code, code, msg, req_id),
            headers=_base_headers(req_id),
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        req_id = getattr(request.state, "request_id", request_id_ctx.get())
        logger.error(
            "error_interno_no_controlado",
            exc_info=exc,
            extra={
                "evento": "error_interno_no_controlado",
                "status": 500,
                "metodo": request.method,
                "ruta": request.url.path,
                "tipoError": type(exc).__name__,
                "error": str(exc),
                "requestId": req_id,
            },
        )
        return JSONResponse(
            status_code=500,
            content=_error_payload(
                500,
                "ERROR_INTERNO",
                "Ocurrió un error interno en el servidor. Comparte el requestId con soporte técnico.",
                req_id,
            ),
            headers=_base_headers(req_id),
        )
