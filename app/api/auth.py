from app.api.dependencies import get_current_user
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
)
from app.db.models.user import User
from app.db.session import get_db
from app.schemas.auth import UserRegister, UserPublic

from pydantic import BaseModel, EmailStr


router = APIRouter(prefix="/auth", tags=["Authentication"])


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post(
    "/register",
    response_model=UserPublic,
    status_code=status.HTTP_201_CREATED,
)
def register_user(
    data: UserRegister,
    db: Session = Depends(get_db),
):
    email = str(data.email).strip().lower()

    existing_user = db.query(User).filter(
        User.email == email
    ).first()

    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    user = User(
        email=email,
        password_hash=hash_password(data.password),
    )

    try:
        db.add(user)
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    return UserPublic(
        id=str(user.id),
        email=user.email,
    )


@router.post("/login", response_model=TokenResponse)
def login_user(
    data: UserLogin,
    db: Session = Depends(get_db),
):
    email = str(data.email).strip().lower()

    user = db.query(User).filter(
        User.email == email
    ).first()

    if not user or not verify_password(
        data.password,
        user.password_hash,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(subject=str(user.id))

    return {
        "access_token": token,
        "token_type": "bearer",
    }
@router.get("/me", response_model=UserPublic)
def get_my_profile(
    current_user: User = Depends(get_current_user),
):
    return UserPublic(
        id=str(current_user.id),
        email=current_user.email,
    )

