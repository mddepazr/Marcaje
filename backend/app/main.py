from contextlib import asynccontextmanager
import time
import uuid
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.v1 import admin, auth, marcaje, observability
from app.core.config import settings
from app.core.error_handlers import register_exception_handlers
from app.core.logging_config import configure_logging, get_logger, request_id_ctx
from app.core.metrics import metrics
from app.db.models import Base
from app.db.session import SessionLocal, engine

configure_logging()
logger = get_logger("http")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title VARCHAR(100) NOT NULL DEFAULT 'Operador General'"
                )
            )
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_code VARCHAR(40)"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS face_descriptor JSON"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS face_samples JSON"))
            conn.execute(text("ALTER TABLE marcaje_settings ADD COLUMN IF NOT EXISTS active_zone_id INTEGER"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS face_enrolled_at TIMESTAMPTZ"))
            conn.execute(text("ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS zone_id INTEGER"))
            conn.execute(
                text(
                    "ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS zone_name VARCHAR(100) NOT NULL DEFAULT 'Planta General'"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS event_type VARCHAR(20) NOT NULL DEFAULT 'ENTRY'"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS recognition_method VARCHAR(30) NOT NULL DEFAULT 'session'"
                )
            )
            conn.execute(text("ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS face_similarity FLOAT"))
            conn.execute(
                text("ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS has_vest BOOLEAN NOT NULL DEFAULT FALSE")
            )
            conn.execute(
                text(
                    "UPDATE users SET job_title = 'Administrador' WHERE role = 'admin' AND job_title = 'Operador General'"
                )
            )
    with SessionLocal() as db:
        admin.ensure_default_roles(db)
        marcaje.ensure_default_zones(db)
    logger.info("api_iniciada", extra={"evento": "api_iniciada", "environment": settings.ENVIRONMENT})
    yield


app = FastAPI(
    title="API Marcaje EPP",
    version="0.7.0",
    lifespan=lifespan,
)

register_exception_handlers(app)


@app.middleware("http")
async def observability_and_security_middleware(request: Request, call_next):
    req_id = request.headers.get("X-Request-ID") or f"req-{uuid.uuid4().hex[:8]}"
    token = request_id_ctx.set(req_id)
    request.state.request_id = req_id
    start = time.perf_counter()

    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        metrics.record(500, duration_ms)
        request_id_ctx.reset(token)
        raise

    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    metrics.record(response.status_code, duration_ms)

    response.headers["X-Request-ID"] = req_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

    log_extra = {
        "evento": "http_request_completada",
        "metodo": request.method,
        "ruta": request.url.path,
        "status": response.status_code,
        "duracionMs": duration_ms,
        "ip": request.client.host if request.client else "desconocida",
        "requestId": req_id,
    }
    if response.status_code >= 500:
        logger.error("http_request_completada", extra=log_extra)
    elif response.status_code >= 400:
        logger.warning("http_request_completada", extra=log_extra)
    else:
        logger.info("http_request_completada", extra=log_extra)

    request_id_ctx.reset(token)
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(marcaje.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")
app.include_router(observability.router, prefix="/api/v1")


@app.get("/api/v1/health", tags=["Sistema"])
def health_check():
    return {"status": "ok", "environment": settings.ENVIRONMENT, "requestId": request_id_ctx.get()}
