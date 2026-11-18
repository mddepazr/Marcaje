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
    person_detected: bool
    is_live_person: bool
    has_helmet: bool
    has_glasses: bool
    has_mask: bool
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
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class AdminUserUpdate(BaseModel):
    job_title: str | None = None
    role: str | None = None
    is_active: bool | None = None
