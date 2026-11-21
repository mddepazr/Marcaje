from datetime import datetime
from pydantic import BaseModel, Field, field_validator


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
    require_epp_on_exit: bool = False
    min_confidence: float
    is_active: bool

    model_config = {"from_attributes": True}


class BiometricProfileOut(BaseModel):
    id: int
    full_name: str
    job_title: str
    employee_code: str | None = None
    face_descriptor: list[float]
    face_samples: list[list[float]] = []


class FaceEnrollIn(BaseModel):
    user_id: int | None = None
    employee_code: str = Field(min_length=2, max_length=40)
    face_descriptor: list[float] = Field(min_length=128, max_length=128)
    # Muestras individuales capturadas al enrolar (hasta 8). Mejoran la precisión
    # porque cada persona se compara contra varias tomas y no solo contra el promedio.
    face_samples: list[list[float]] | None = Field(default=None, max_length=8)

    @field_validator("face_samples")
    @classmethod
    def _validate_samples(cls, v: list[list[float]] | None) -> list[list[float]] | None:
        if v is None:
            return v
        for sample in v:
            if len(sample) != 128:
                raise ValueError("Cada muestra facial debe tener 128 valores.")
        return v


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
