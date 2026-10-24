
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
import re

from app.api.dependencies import get_current_user
from app.db.session import get_db
from app.db.models.user import User
from app.db.models.business import Business
from app.db.models.membership import Membership


router = APIRouter(prefix="/businesses", tags=["Businesses"])


class BusinessCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)


class BusinessPublic(BaseModel):
    id: str
    name: str
    slug: str
    email: str | None = None



class BusinessUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    email: str | None = Field(default=None, max_length=255)




@router.post("/", response_model=BusinessPublic, status_code=status.HTTP_201_CREATED)
def create_business(
    data: BusinessCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    name = data.name.strip()

    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Business name must contain at least 2 characters.")

    base_slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    if not base_slug:
        base_slug = "business"

    slug = base_slug
    suffix = 2

    while db.query(Business).filter(Business.slug == slug).first():
        slug = f"{base_slug}-{suffix}"
        suffix += 1

    business = Business(name=name, slug=slug)

    try:
        db.add(business)
        db.flush()

        membership = Membership(
            user_id=current_user.id,
            business_id=business.id,
            role="owner",
        )
        db.add(membership)
        db.commit()
        db.refresh(business)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Could not create the business due to a database conflict.",
        )

    return BusinessPublic(
        id=str(business.id),
        name=business.name,
        slug=business.slug,
        email=business.email,
    )

@router.get("/", response_model=list[BusinessPublic])
def list_businesses(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    businesses = (
        db.query(Business)
        .join(Membership, Membership.business_id == Business.id)
        .filter(Membership.user_id == current_user.id)
        .order_by(Business.name)
        .all()
    )

    return [
        BusinessPublic(
            id=str(business.id),
            name=business.name,
            slug=business.slug,
            email=business.email,
        )
        for business in businesses
    ]


@router.patch("/{business_id}", response_model=BusinessPublic)
def update_business(
    business_id: str,
    data: BusinessUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    business = (
        db.query(Business)
        .join(Membership, Membership.business_id == Business.id)
        .filter(
            Membership.user_id == current_user.id,
            Business.id == business_id,
        )
        .first()
    )

    if not business:
        raise HTTPException(
            status_code=404,
            detail="Business not found or you do not have access.",
        )

    
    if data.name is not None:
        name = data.name.strip()

        if len(name) < 2:
            raise HTTPException(
                status_code=422,
                detail="Business name must contain at least 2 characters.",
            )

        business.name = name

        base_slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        if not base_slug:
            base_slug = "business"

        slug = base_slug
        suffix = 2

        while db.query(Business).filter(
            Business.slug == slug,
            Business.id != business.id,
        ).first():
            slug = f"{base_slug}-{suffix}"
            suffix += 1

        business.slug = slug

    if "email" in data.model_fields_set:
        email = data.email.strip() if data.email else None
        business.email = email


    db.commit()
    db.refresh(business)

    return BusinessPublic(
        id=str(business.id),
        name=business.name,
        slug=business.slug,
        email=business.email,
    )

