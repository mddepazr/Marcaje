from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(150), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(30), default="employee", nullable=False)
    job_title: Mapped[str] = mapped_column(String(100), default="Operador General", nullable=False)
    employee_code: Mapped[str | None] = mapped_column(String(40), unique=True, nullable=True)
    face_descriptor: Mapped[list | None] = mapped_column(JSON, nullable=True)
    face_samples: Mapped[list | None] = mapped_column(JSON, nullable=True)
    face_enrolled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    records: Mapped[list["AttendanceRecord"]] = relationship(back_populates="user")


class JobRole(Base):
    __tablename__ = "job_roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class WorkZone(Base):
    __tablename__ = "work_zones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    require_helmet: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    require_glasses: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    require_mask: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    require_vest: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    require_epp_on_exit: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    min_confidence: Mapped[float] = mapped_column(Float, default=0.20, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class AttendanceRecord(Base):
    __tablename__ = "attendance_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    zone_id: Mapped[int | None] = mapped_column(ForeignKey("work_zones.id"), nullable=True, index=True)
    zone_name: Mapped[str] = mapped_column(String(100), default="Planta General", nullable=False)
    event_type: Mapped[str] = mapped_column(String(20), default="ENTRY", nullable=False)
    recognition_method: Mapped[str] = mapped_column(String(30), default="session", nullable=False)
    face_similarity: Mapped[float | None] = mapped_column(Float, nullable=True)
    person_detected: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_live_person: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_helmet: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_glasses: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_mask: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_vest: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_compliant: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    detections_raw: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    evidence_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )

    user: Mapped["User"] = relationship(back_populates="records")


class MarcajeSettings(Base):
    __tablename__ = "marcaje_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    zone_name: Mapped[str] = mapped_column(String(100), default="Área Operativa General", nullable=False)
    require_helmet: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    require_glasses: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    require_mask: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    min_confidence: Mapped[float] = mapped_column(Float, default=0.20, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
