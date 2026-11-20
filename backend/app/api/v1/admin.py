import csv
import io
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from app.api.v1.auth import get_current_user
from app.api.v1.marcaje import ensure_default_zones, get_or_create_settings
from app.db.models import AttendanceRecord, JobRole, User, WorkZone
from app.db.session import get_db
from app.schemas.admin import (
    AdminAttendanceOut,
    AdminStatsOut,
    AdminUserOut,
    AdminUserUpdate,
    JobRoleCreate,
    JobRoleOut,
    MarcajeSettingsOut,
    MarcajeSettingsUpdate,
    WorkZoneCreate,
    WorkZoneUpdate,
)
from app.schemas.marcaje import WorkZoneOut

router = APIRouter(prefix="/admin", tags=["Administración"])

DEFAULT_ROLES = [
    ("Operador General", False),
    ("Técnico de Mantenimiento", False),
    ("Operador de Maquinaria", False),
    ("Auxiliar de Bodega", False),
    ("Inspector de Calidad", False),
    ("Supervisor de Seguridad", True),
    ("Administrador", True),
]


def ensure_default_roles(db: Session) -> None:
    count = db.scalar(select(func.count(JobRole.id))) or 0
    if count == 0:
        for name, is_admin in DEFAULT_ROLES:
            db.add(JobRole(name=name, is_admin=is_admin))
        db.commit()


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso denegado: se requieren permisos de administrador.",
        )
    return current_user


@router.get("/roles", response_model=list[JobRoleOut])
def list_job_roles(
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    ensure_default_roles(db)
    return list(db.scalars(select(JobRole).order_by(JobRole.id.asc())).all())


@router.post("/roles", response_model=JobRoleOut, status_code=status.HTTP_201_CREATED)
def create_job_role(
    payload: JobRoleCreate,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    ensure_default_roles(db)
    clean_name = payload.name.strip()
    existing = db.scalar(select(JobRole).where(func.lower(JobRole.name) == clean_name.lower()))
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El puesto '{clean_name}' ya existe en la lista.",
        )

    new_role = JobRole(name=clean_name, is_admin=payload.is_admin)
    db.add(new_role)
    db.commit()
    db.refresh(new_role)
    return new_role


@router.get("/zones", response_model=list[WorkZoneOut])
def list_all_zones(
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    ensure_default_zones(db)
    return list(db.scalars(select(WorkZone).order_by(WorkZone.id.asc())).all())


@router.post("/zones", response_model=WorkZoneOut, status_code=status.HTTP_201_CREATED)
def create_work_zone(
    payload: WorkZoneCreate,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    ensure_default_zones(db)
    clean_name = payload.name.strip()
    existing = db.scalar(select(WorkZone).where(func.lower(WorkZone.name) == clean_name.lower()))
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El área '{clean_name}' ya existe.",
        )
    zone = WorkZone(
        name=clean_name,
        description=payload.description.strip(),
        require_helmet=payload.require_helmet,
        require_glasses=payload.require_glasses,
        require_mask=payload.require_mask,
        require_vest=payload.require_vest,
        min_confidence=payload.min_confidence,
        is_active=True,
    )
    db.add(zone)
    db.commit()
    db.refresh(zone)
    return zone


@router.put("/zones/{zone_id}", response_model=WorkZoneOut)
def update_work_zone(
    zone_id: int,
    payload: WorkZoneUpdate,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    zone = db.get(WorkZone, zone_id)
    if not zone:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Área no encontrada.")

    if payload.name is not None:
        zone.name = payload.name.strip()
    if payload.description is not None:
        zone.description = payload.description.strip()
    if payload.require_helmet is not None:
        zone.require_helmet = payload.require_helmet
    if payload.require_glasses is not None:
        zone.require_glasses = payload.require_glasses
    if payload.require_mask is not None:
        zone.require_mask = payload.require_mask
    if payload.require_vest is not None:
        zone.require_vest = payload.require_vest
    if payload.min_confidence is not None:
        zone.min_confidence = payload.min_confidence
    if payload.is_active is not None:
        zone.is_active = payload.is_active

    db.commit()
    db.refresh(zone)
    return zone


@router.get("/settings", response_model=MarcajeSettingsOut)
def read_settings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_or_create_settings(db)


@router.put("/settings", response_model=MarcajeSettingsOut)
def update_settings(
    payload: MarcajeSettingsUpdate,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    cfg = get_or_create_settings(db)
    cfg.zone_name = payload.zone_name.strip()
    cfg.require_helmet = payload.require_helmet
    cfg.require_glasses = payload.require_glasses
    cfg.require_mask = payload.require_mask
    cfg.min_confidence = payload.min_confidence
    db.commit()
    db.refresh(cfg)
    return cfg


@router.get("/stats", response_model=AdminStatsOut)
def get_admin_stats(
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    total_scans = db.scalar(select(func.count(AttendanceRecord.id))) or 0
    compliant_scans = (
        db.scalar(select(func.count(AttendanceRecord.id)).where(AttendanceRecord.is_compliant.is_(True))) or 0
    )
    live_scans = (
        db.scalar(select(func.count(AttendanceRecord.id)).where(AttendanceRecord.is_live_person.is_(True))) or 0
    )
    total_users = db.scalar(select(func.count(User.id))) or 0

    non_compliant_scans = total_scans - compliant_scans
    compliance_rate = round((compliant_scans / total_scans) * 100, 1) if total_scans > 0 else 0.0

    return AdminStatsOut(
        total_scans=total_scans,
        compliant_scans=compliant_scans,
        non_compliant_scans=non_compliant_scans,
        compliance_rate=compliance_rate,
        live_scans=live_scans,
        total_users=total_users,
    )


@router.get("/records", response_model=list[AdminAttendanceOut])
def list_all_records(
    status_filter: str = Query(default="all"),
    search: str = Query(default=""),
    limit: int = Query(default=100, le=500),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    stmt = (
        select(AttendanceRecord, User)
        .join(User, AttendanceRecord.user_id == User.id)
        .order_by(AttendanceRecord.created_at.desc())
        .limit(limit)
    )

    if status_filter == "approved":
        stmt = stmt.where(AttendanceRecord.is_compliant.is_(True))
    elif status_filter == "rejected":
        stmt = stmt.where(AttendanceRecord.is_compliant.is_(False))

    if search.strip():
        term = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                User.full_name.ilike(term),
                User.email.ilike(term),
                AttendanceRecord.zone_name.ilike(term),
            )
        )

    rows = db.execute(stmt).all()
    return [
        AdminAttendanceOut(
            id=rec.id,
            user_id=user.id,
            user_full_name=user.full_name,
            user_email=user.email,
            zone_name=rec.zone_name,
            event_type=rec.event_type,
            recognition_method=rec.recognition_method,
            face_similarity=rec.face_similarity,
            person_detected=rec.person_detected,
            is_live_person=rec.is_live_person,
            has_helmet=rec.has_helmet,
            has_glasses=rec.has_glasses,
            has_mask=rec.has_mask,
            has_vest=rec.has_vest,
            is_compliant=rec.is_compliant,
            confidence=rec.confidence,
            has_evidence=bool(rec.evidence_path and Path(rec.evidence_path).exists()),
            created_at=rec.created_at,
        )
        for rec, user in rows
    ]


@router.get("/records/export")
def export_records_csv(
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    stmt = (
        select(AttendanceRecord, User)
        .join(User, AttendanceRecord.user_id == User.id)
        .order_by(AttendanceRecord.created_at.desc())
    )
    rows = db.execute(stmt).all()

    buffer = io.StringIO()
    buffer.write("\ufeff")
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "ID",
            "Fecha_UTC",
            "Empleado",
            "Puesto",
            "Area",
            "Movimiento",
            "Metodo_ID",
            "Estado_EPP",
            "Casco",
            "Lentes",
            "Mascarilla",
            "Chaleco",
            "Confianza_Pct",
        ]
    )

    for rec, user in rows:
        writer.writerow(
            [
                rec.id,
                rec.created_at.strftime("%Y-%m-%d %H:%M:%S"),
                user.full_name,
                user.job_title,
                rec.zone_name,
                "Entrada" if rec.event_type == "ENTRY" else "Salida",
                "Biometrico Facial" if rec.recognition_method == "face_biometric" else "Sesion",
                "Aprobado" if rec.is_compliant else "Rechazado",
                "Si" if rec.has_helmet else "No",
                "Si" if rec.has_glasses else "No",
                "Si" if rec.has_mask else "No",
                "Si" if rec.has_vest else "No",
                round(rec.confidence * 100, 1),
            ]
        )

    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=reporte_marcaje_epp.csv"},
    )


@router.get("/evidence/{record_id}")
def get_evidence_photo(
    record_id: int,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    rec = db.get(AttendanceRecord, record_id)
    if not rec or not rec.evidence_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidencia no encontrada.")
    path = Path(rec.evidence_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="El archivo de imagen ya no existe.")
    return FileResponse(path, media_type="image/jpeg")


@router.get("/users", response_model=list[AdminUserOut])
def list_users(
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    users = db.scalars(select(User).order_by(User.id.asc())).all()
    return [
        AdminUserOut(
            id=u.id,
            full_name=u.full_name,
            email=u.email,
            role=u.role,
            job_title=u.job_title,
            employee_code=u.employee_code,
            has_face_enrolled=isinstance(u.face_descriptor, list) and len(u.face_descriptor) == 128,
            is_active=u.is_active,
            created_at=u.created_at,
        )
        for u in users
    ]


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def update_user(
    user_id: int,
    payload: AdminUserUpdate,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado.")

    if target.id == admin_user.id and payload.role == "employee":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puedes quitarte el rol de administrador a ti mismo.",
        )

    if payload.job_title is not None:
        target.job_title = payload.job_title.strip()

    if payload.employee_code is not None:
        target.employee_code = payload.employee_code.strip().upper() or None

    if payload.role is not None:
        if payload.role not in {"employee", "admin"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rol inválido.")
        target.role = payload.role

    if payload.is_active is not None:
        if target.id == admin_user.id and not payload.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No puedes desactivar tu propia cuenta.",
            )
        target.is_active = payload.is_active

    db.commit()
    db.refresh(target)
    return AdminUserOut(
        id=target.id,
        full_name=target.full_name,
        email=target.email,
        role=target.role,
        job_title=target.job_title,
        employee_code=target.employee_code,
        has_face_enrolled=isinstance(target.face_descriptor, list) and len(target.face_descriptor) == 128,
        is_active=target.is_active,
        created_at=target.created_at,
    )
