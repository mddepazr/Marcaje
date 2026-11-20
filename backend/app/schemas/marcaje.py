from datetime import datetime
from pydantic import BaseModel, Field


class DetectionItem(BaseModel):
    label: str
    confidence: float
    bbox: list[float]


class WorkZoneOut(BaseModel):
    id: int
    name: str
    description: str
    require_helmet: bool
    require_glasses: bool
    require_mask: bool
    require_vest: bool
    min_confidence: float
    is_active: bool

    model_config = {"from_attributes": True}


class BiometricProfileOut(BaseModel):
    id: int
    full_name: str
    job_title: str
    employee_code: str | None = None
    face_descriptor: list[float]


class FaceEnrollIn(BaseModel):
    user_id: int | None = None
    employee_code: str | None = Field(default=None, max_length=40)
    face_descriptor: list[float] = Field(min_length=128, max_length=128)


class MarcajeOut(BaseModel):
    id: int
    user_id: int
    user_full_name: str = ""
    zone_id: int | None = None
    zone_name: str = "Planta General"
    event_type: str = "ENTRY"
    recognition_method: str = "session"
    face_similarity: float | None = None
    person_detected: bool
    is_live_person: bool
    has_helmet: bool
    has_glasses: bool
    has_mask: bool
    has_vest: bool = False
    is_compliant: bool
    confidence: float
    detections_raw: list[DetectionItem] = []
    missing_items: list[str] = []
    created_at: datetime

    model_config = {"from_attributes": True}
