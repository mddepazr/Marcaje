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


class AttendanceRecord(Base):
    __tablename__ = "attendance_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    person_detected: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_live_person: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_helmet: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_glasses: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_mask: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
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
