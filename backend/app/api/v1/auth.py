from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
import jwt
from pwdlib import PasswordHash
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.models import User
from app.db.session import get_db

router = APIRouter(prefix="/auth", tags=["Autenticación"])
password_hash = PasswordHash.recommended()

SECRET_KEY = settings.SECRET_KEY
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60 * 24 * 7


class RegisterIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    employee_code: str = Field(min_length=2, max_length=40)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserOut(BaseModel):
    id: int
    full_name: str
    email: str
    role: str
    job_title: str
    employee_code: str | None = None
    has_face_enrolled: bool = False
    is_active: bool


def serialize_user(user: User) -> UserOut:
    enrolled = isinstance(user.face_descriptor, list) and len(user.face_descriptor) == 128
    return UserOut(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        role=user.role,
        job_title=user.job_title,
        employee_code=user.employee_code,
        has_face_enrolled=enrolled,
        is_active=user.is_active,
    )


def _create_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user_id), "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def _set_auth_cookie(response: Response, token: str) -> None:
    is_prod = settings.ENVIRONMENT == "production"
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=is_prod,
        samesite="none" if is_prod else "lax",
        max_age=TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )


def get_optional_user(
    access_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> User | None:
    if not access_token:
        return None
    try:
        payload = jwt.decode(access_token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub", 0))
    except Exception:
        return None
    user = db.get(User, user_id)
    if not user or not user.is_active:
        return None
    return user


def get_current_user(
    access_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not access_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No autenticado")

    try:
        payload = jwt.decode(access_token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub", 0))
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión inválida o expirada")

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario inválido o desactivado")

    return user


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterIn, response: Response, db: Session = Depends(get_db)):
    email_clean = payload.email.lower().strip()
    code_clean = payload.employee_code.strip().upper()
    if len(code_clean) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ingresa un código o carné de empleado válido.",
        )

    existing = db.scalar(select(User).where(User.email == email_clean))
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Este correo ya está registrado.")

    existing_code = db.scalar(select(User).where(User.employee_code == code_clean))
    if existing_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El código o carné '{code_clean}' ya está asignado a otro colaborador.",
        )

    user = User(
        full_name=payload.full_name.strip(),
        employee_code=code_clean,
        email=email_clean,
        hashed_password=password_hash.hash(payload.password),
        role="employee",
        job_title="Operador General",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    _set_auth_cookie(response, _create_token(user.id))
    return serialize_user(user)


@router.post("/login", response_model=UserOut)
def login(payload: LoginIn, response: Response, db: Session = Depends(get_db)):
    email_clean = payload.email.lower().strip()
    user = db.scalar(select(User).where(User.email == email_clean))
    if not user or not password_hash.verify(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales incorrectas.")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tu cuenta está desactivada.")

    _set_auth_cookie(response, _create_token(user.id))
    return serialize_user(user)


@router.post("/logout")
def logout(response: Response):
    is_prod = settings.ENVIRONMENT == "production"
    response.delete_cookie(
        key="access_token",
        path="/",
        secure=is_prod,
        samesite="none" if is_prod else "lax",
    )
    return {"message": "Sesión cerrada"}


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return serialize_user(current_user)
