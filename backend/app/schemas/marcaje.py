from datetime import datetime
from pydantic import BaseModel


class DetectionItem(BaseModel):
    label: str
    confidence: float
    bbox: list[float]


class MarcajeOut(BaseModel):
    id: int
    user_id: int
    person_detected: bool
    is_live_person: bool
    has_helmet: bool
    has_glasses: bool
    has_mask: bool
    is_compliant: bool
    confidence: float
    detections_raw: list[DetectionItem]
    created_at: datetime

    model_config = {"from_attributes": True}
