from datetime import datetime, timezone
from pathlib import Path
import uuid
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.api.v1.auth import get_current_user
from app.db.models import AttendanceRecord, MarcajeSettings, User, WorkZone
from app.db.session import get_db
from app.schemas.marcaje import BiometricProfileOut, FaceEnrollIn, MarcajeOut, WorkZoneOut
from app.services.vision.detector import get_detector
from app.services.vision.liveness import verify_liveness_sequence

router = APIRouter(prefix="/marcaje", tags=["Marcaje EPP"])

UPLOAD_DIR = Path("/app/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_FILE_SIZE = 5 * 1024 * 1024

DEFAULT_ZONES = [
    ("Planta General", "Ingreso principal de operaciones", True, True, True, True),
    ("Destilación", "Área de procesos térmicos y extracción", True, True, True, True),
    ("Área de Especias", "Manipulación de materia prima y molienda", False, False, True, True),
    ("Bodega y Logística", "Carga, descarga y despacho", True, False, False, True),
]


def ensure_default_zones(db: Session) -> None:
    count = db.scalar(select(func.count(WorkZone.id))) or 0
    if count == 0:
        for name, desc, helmet, glasses, mask, vest in DEFAULT_ZONES:
            db.add(
                WorkZone(
                    name=name,
                    description=desc,
                    require_helmet=helmet,
                    require_glasses=glasses,
                    require_mask=mask,
                    require_vest=vest,
                    min_confidence=0.20,
                    is_active=True,
                )
            )
        db.commit()


def get_or_create_settings(db: Session) -> MarcajeSettings:
    cfg = db.get(MarcajeSettings, 1)
    if cfg is None:
        cfg = MarcajeSettings(
            id=1,
            zone_name="Planta General",
            require_helmet=True,
            require_glasses=True,
            require_mask=True,
            min_confidence=0.20,
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


@router.get("/zones", response_model=list[WorkZoneOut])
def list_active_zones(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_default_zones(db)
    stmt = select(WorkZone).where(WorkZone.is_active.is_(True)).order_by(WorkZone.id.asc())
    return list(db.scalars(stmt).all())


@router.get("/biometric-directory", response_model=list[BiometricProfileOut])
def get_biometric_directory(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = (
        select(User)
        .where(User.is_active.is_(True), User.face_descriptor.is_not(None))
        .order_by(User.full_name.asc())
    )
    users = db.scalars(stmt).all()
    return [
        BiometricProfileOut(
            id=u.id,
            full_name=u.full_name,
            job_title=u.job_title,
            employee_code=u.employee_code,
            face_descriptor=u.face_descriptor,
        )
        for u in users
        if isinstance(u.face_descriptor, list) and len(u.face_descriptor) == 128
    ]


@router.post("/enroll-face")
def enroll_face(
    payload: FaceEnrollIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_id = payload.user_id if payload.user_id is not None else current_user.id
    if target_id != current_user.id and current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo un administrador puede registrar el rostro de otro colaborador.",
        )

    target_user = db.get(User, target_id)
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Colaborador no encontrado.")

    if payload.employee_code is not None and payload.employee_code.strip():
        clean_code = payload.employee_code.strip().upper()
        dup = db.scalar(
            select(User).where(User.employee_code == clean_code, User.id != target_user.id)
        )
        if dup:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"El código '{clean_code}' ya pertenece a {dup.full_name}.",
            )
        target_user.employee_code = clean_code

    target_user.face_descriptor = [round(float(v), 6) for v in payload.face_descriptor]
    target_user.face_enrolled_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(target_user)

    return {
        "message": f"Perfil biométrico guardado para {target_user.full_name}.",
        "user_id": target_user.id,
        "full_name": target_user.full_name,
    }


@router.post("/scan", response_model=MarcajeOut, status_code=status.HTTP_201_CREATED)
def scan_ppe(
    files: list[UploadFile] = File(...),
    mode: str = Form(default="live"),
    zone_id: int | None = Form(default=None),
    event_type: str = Form(default="ENTRY"),
    recognized_user_id: int | None = Form(default=None),
    face_similarity: float | None = Form(default=None),
    client_liveness_verified: bool = Form(default=False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No se recibieron imágenes.")

    normalized_event = event_type.upper().strip()
    if normalized_event not in {"ENTRY", "EXIT"}:
        normalized_event = "ENTRY"

    target_user = current_user
    recognition_method = "session"
    if recognized_user_id is not None:
        matched = db.get(User, recognized_user_id)
        if not matched or not matched.is_active:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="El colaborador identificado no está activo en el sistema.",
            )
        target_user = matched
        recognition_method = "face_biometric"

    frames_bytes: list[bytes] = []
    for f in files[:3]:
        if f.content_type not in ALLOWED_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Formato no permitido. Usa JPG, PNG o WEBP.",
            )
        raw = f.file.read()
        if len(raw) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Una de las imágenes supera el límite de 5 MB.",
            )
        frames_bytes.append(raw)

    is_live_person = False
    if mode == "live":
        if client_liveness_verified:
            is_live_person = True
        else:
            is_live_person, liveness_msg = verify_liveness_sequence(frames_bytes)
            if not is_live_person:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Prueba de vida fallida: {liveness_msg}",
                )

    ensure_default_zones(db)
    zone = db.get(WorkZone, zone_id) if zone_id is not None else None
    if zone is None:
        zone = db.scalar(select(WorkZone).where(WorkZone.is_active.is_(True)).order_by(WorkZone.id.asc()))

    if zone is not None:
        zone_name = zone.name
        req_helmet = zone.require_helmet
        req_glasses = zone.require_glasses
        req_mask = zone.require_mask
        req_vest = zone.require_vest
        min_conf = zone.min_confidence
    else:
        cfg = get_or_create_settings(db)
        zone_name = cfg.zone_name
        req_helmet = cfg.require_helmet
        req_glasses = cfg.require_glasses
        req_mask = cfg.require_mask
        req_vest = False
        min_conf = cfg.min_confidence

    target_bytes = frames_bytes[len(frames_bytes) // 2]
    detector = get_detector()
    analysis = detector.analyze_image(target_bytes, conf_threshold=min_conf)

    if analysis["spoof_device_detected"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Fraude detectado: se identificó una pantalla o teléfono frente a la cámara.",
        )

    if not analysis["person_detected"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No se detectó ninguna persona frente a la cámara.",
        )

    missing_items: list[str] = []
    if normalized_event == "ENTRY":
        if req_helmet and not analysis["has_helmet"]:
            missing_items.append("Casco")
        if req_glasses and not analysis["has_glasses"]:
            missing_items.append("Lentes")
        if req_mask and not analysis["has_mask"]:
            missing_items.append("Mascarilla")
        if req_vest and not analysis["has_vest"]:
            missing_items.append("Chaleco")

    is_compliant = len(missing_items) == 0

    filename = f"{target_user.id}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.jpg"
    file_path = UPLOAD_DIR / filename
    file_path.write_bytes(target_bytes)

    record = AttendanceRecord(
        user_id=target_user.id,
        zone_id=zone.id if zone else None,
        zone_name=zone_name,
        event_type=normalized_event,
        recognition_method=recognition_method,
        face_similarity=round(float(face_similarity), 4) if face_similarity is not None else None,
        person_detected=analysis["person_detected"],
        is_live_person=is_live_person,
        has_helmet=analysis["has_helmet"],
        has_glasses=analysis["has_glasses"],
        has_mask=analysis["has_mask"],
        has_vest=analysis["has_vest"],
        is_compliant=is_compliant,
        confidence=analysis["confidence"],
        detections_raw=analysis["detections_raw"],
        evidence_path=str(file_path),
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return MarcajeOut(
        id=record.id,
        user_id=record.user_id,
        user_full_name=target_user.full_name,
        zone_id=record.zone_id,
        zone_name=record.zone_name,
        event_type=record.event_type,
        recognition_method=record.recognition_method,
        face_similarity=record.face_similarity,
        person_detected=record.person_detected,
        is_live_person=record.is_live_person,
        has_helmet=record.has_helmet,
        has_glasses=record.has_glasses,
        has_mask=record.has_mask,
        has_vest=record.has_vest,
        is_compliant=record.is_compliant,
        confidence=record.confidence,
        detections_raw=record.detections_raw,
        missing_items=missing_items,
        created_at=record.created_at,
    )


@router.get("/history", response_model=list[MarcajeOut])
def get_history(
    limit: int = 20,
    kiosk: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = (
        select(AttendanceRecord, User)
        .join(User, AttendanceRecord.user_id == User.id)
        .order_by(AttendanceRecord.created_at.desc())
        .limit(min(limit, 100))
    )
    if not kiosk:
        stmt = stmt.where(AttendanceRecord.user_id == current_user.id)

    rows = db.execute(stmt).all()
    return [
        MarcajeOut(
            id=rec.id,
            user_id=rec.user_id,
            user_full_name=u.full_name,
            zone_id=rec.zone_id,
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
            detections_raw=rec.detections_raw,
            missing_items=[],
            created_at=rec.created_at,
        )
        for rec, u in rows
    ]
