from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from app.api.v1 import admin, auth, marcaje
from app.core.config import settings
from app.db.models import Base
from app.db.session import SessionLocal, engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title VARCHAR(100) NOT NULL DEFAULT 'Operador General'"
            )
        )
        conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_code VARCHAR(40)")
        )
        conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS face_descriptor JSON")
        )
        conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS face_samples JSON")
        )
        conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS face_enrolled_at TIMESTAMPTZ")
        )
        conn.execute(
            text("ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS zone_id INTEGER")
        )
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
        conn.execute(
            text("ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS face_similarity FLOAT")
        )
        conn.execute(
            text(
                "ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS has_vest BOOLEAN NOT NULL DEFAULT FALSE"
            )
        )
        conn.execute(
            text(
                "UPDATE users SET job_title = 'Administrador' WHERE role = 'admin' AND job_title = 'Operador General'"
            )
        )
    with SessionLocal() as db:
        admin.ensure_default_roles(db)
        marcaje.ensure_default_zones(db)
    yield


app = FastAPI(
    title="API Marcaje EPP",
    version="0.6.0",
    lifespan=lifespan,
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": f"Error interno del servidor: {str(exc)}"},
        headers={
            "Access-Control-Allow-Origin": settings.FRONTEND_URL,
            "Access-Control-Allow-Credentials": "true",
        },
    )


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
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


@app.get("/api/v1/health", tags=["Sistema"])
def health_check():
    return {"status": "ok", "environment": settings.ENVIRONMENT}
