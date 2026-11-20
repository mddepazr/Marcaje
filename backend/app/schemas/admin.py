from datetime import datetime
from pydantic import BaseModel, Field


class MarcajeSettingsOut(BaseModel):
    zone_name: str
    require_helmet: bool
    require_glasses: bool
    require_mask: bool
    min_confidence: float

    model_config = {"from_attributes": True}


class MarcajeSettingsUpdate(BaseModel):
    zone_name: str = Field(min_length=2, max_length=100)
    require_helmet: bool
    require_glasses: bool
    require_mask: bool
    min_confidence: float = Field(ge=0.05, le=0.90)


class WorkZoneCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    description: str = Field(default="", max_length=255)
    require_helmet: bool = True
    require_glasses: bool = True
    require_mask: bool = True
    require_vest: bool = True
    min_confidence: float = Field(default=0.20, ge=0.05, le=0.90)


class WorkZoneUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=255)
    require_helmet: bool | None = None
    require_glasses: bool | None = None
    require_mask: bool | None = None
    require_vest: bool | None = None
    min_confidence: float | None = Field(default=None, ge=0.05, le=0.90)
    is_active: bool | None = None


class JobRoleOut(BaseModel):
    id: int
    name: str
    is_admin: bool

    model_config = {"from_attributes": True}


class JobRoleCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    is_admin: bool = False


class AdminAttendanceOut(BaseModel):
    id: int
    user_id: int
    user_full_name: str
    user_email: str
    zone_name: str
    event_type: str
    recognition_method: str
    face_similarity: float | None
    person_detected: bool
    is_live_person: bool
    has_helmet: bool
    has_glasses: bool
    has_mask: bool
    has_vest: bool
    is_compliant: bool
    confidence: float
    has_evidence: bool
    created_at: datetime


class AdminStatsOut(BaseModel):
    total_scans: int
    compliant_scans: int
    non_compliant_scans: int
    compliance_rate: float
    live_scans: int
    total_users: int


class AdminUserOut(BaseModel):
    id: int
    full_name: str
    email: str
    role: str
    job_title: str
    employee_code: str | None
    has_face_enrolled: bool
    is_active: bool
    created_at: datetime


class AdminUserUpdate(BaseModel):
    job_title: str | None = None
    role: str | None = None
    employee_code: str | None = None
    is_active: bool | None = None
