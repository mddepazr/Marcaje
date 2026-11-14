from datetime import datetime, timezone
from pathlib import Path
import uuid
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.api.v1.auth import get_current_user
from app.db.models import AttendanceRecord, User
from app.db.session import get_db
from app.schemas.marcaje import MarcajeOut
from app.services.vision.detector import get_detector
from app.services.vision.liveness import verify_liveness_sequence

router = APIRouter(prefix="/marcaje", tags=["Marcaje EPP"])

UPLOAD_DIR = Path("/app/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB


@router.post("/scan", response_model=MarcajeOut, status_code=status.HTTP_201_CREATED)
async def scan_ppe(
    files: list[UploadFile] = File(...),
    mode: str = Form(default="live"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No se recibieron imágenes.")

    frames_bytes: list[bytes] = []
    for f in files[:3]:
        if f.content_type not in ALLOWED_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Formato no permitido. Usa JPG, PNG o WEBP.",
            )
        raw = await f.read()
        if len(raw) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Una de las imágenes supera el límite de 5 MB.",
            )
        frames_bytes.append(raw)

    # 1. Prueba de vida obligatoria en modo cámara en vivo
    is_live_person = False
    if mode == "live":
        is_live_person, liveness_msg = verify_liveness_sequence(frames_bytes)
        if not is_live_person:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Prueba de vida fallida: {liveness_msg}",
            )

    # 2. Analizar el fotograma principal para persona, EPP y pantallas
    target_bytes = frames_bytes[len(frames_bytes) // 2]
    detector = get_detector()
    analysis = detector.analyze_image(target_bytes)

    if analysis["spoof_device_detected"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Fraude detectado: se identificó una pantalla o dispositivo móvil frente a la cámara.",
        )

    if not analysis["person_detected"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No se detectó ninguna persona en la imagen. Acércate a la cámara e intenta de nuevo.",
        )

    filename = f"{current_user.id}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.jpg"
    file_path = UPLOAD_DIR / filename
    file_path.write_bytes(target_bytes)

    record = AttendanceRecord(
        user_id=current_user.id,
        person_detected=analysis["person_detected"],
        is_live_person=is_live_person,
        has_helmet=analysis["has_helmet"],
        has_glasses=analysis["has_glasses"],
        has_mask=analysis["has_mask"],
        is_compliant=analysis["is_compliant"],
        confidence=analysis["confidence"],
        detections_raw=analysis["detections_raw"],
        evidence_path=str(file_path),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.get("/history", response_model=list[MarcajeOut])
def get_history(
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = (
        select(AttendanceRecord)
        .where(AttendanceRecord.user_id == current_user.id)
        .order_by(AttendanceRecord.created_at.desc())
        .limit(min(limit, 100))
    )
    return list(db.scalars(stmt).all())
