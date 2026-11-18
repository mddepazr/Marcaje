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
    is_active: bool

    model_config = {"from_attributes": True}


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
    existing = db.scalar(select(User).where(User.email == email_clean))
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Este correo ya está registrado.")

    user = User(
        full_name=payload.full_name.strip(),
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
    return user


@router.post("/login", response_model=UserOut)
def login(payload: LoginIn, response: Response, db: Session = Depends(get_db)):
    email_clean = payload.email.lower().strip()
    user = db.scalar(select(User).where(User.email == email_clean))
    if not user or not password_hash.verify(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales incorrectas.")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tu cuenta está desactivada.")

    _set_auth_cookie(response, _create_token(user.id))
    return user


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
    return current_user
