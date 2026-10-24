
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user
from app.db.session import get_db
from app.db.models.user import User
from app.db.models.business import Business
from app.db.models.membership import Membership
from app.db.models.knowledge import KnowledgeEntry


router = APIRouter(
    prefix="/businesses/{business_id}/knowledge",
    tags=["Knowledge Base"],
)


class KnowledgeCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    content: str = Field(min_length=1, max_length=20000)


class KnowledgePublic(BaseModel):
    id: UUID
    business_id: UUID
    title: str
    content: str
    created_at: object


def check_business_access(
    business_id: UUID,
    current_user: User,
    db: Session,
):
    membership = (
        db.query(Membership)
        .filter(
            Membership.business_id == business_id,
            Membership.user_id == current_user.id,
        )
        .first()
    )

    if not membership:
        raise HTTPException(
            status_code=404,
            detail="Business not found or you do not have access.",
        )


@router.post(
    "/",
    response_model=KnowledgePublic,
    status_code=status.HTTP_201_CREATED,
)
def create_knowledge(
    business_id: UUID,
    data: KnowledgeCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    check_business_access(business_id, current_user, db)

    entry = KnowledgeEntry(
        business_id=business_id,
        title=data.title.strip(),
        content=data.content.strip(),
    )

    if len(entry.title) < 2 or not entry.content:
        raise HTTPException(
            status_code=422,
            detail="Title must contain at least 2 characters and content cannot be empty.",
        )

    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/", response_model=list[KnowledgePublic])
def list_knowledge(
    business_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    check_business_access(business_id, current_user, db)

    return (
        db.query(KnowledgeEntry)
        .filter(KnowledgeEntry.business_id == business_id)
        .order_by(KnowledgeEntry.created_at.desc())
        .all()
    )


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_knowledge(
    business_id: UUID,
    entry_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    check_business_access(business_id, current_user, db)

    entry = (
        db.query(KnowledgeEntry)
        .filter(
            KnowledgeEntry.id == entry_id,
            KnowledgeEntry.business_id == business_id,
        )
        .first()
    )

    if not entry:
        raise HTTPException(
            status_code=404,
            detail="Knowledge entry not found.",
        )

    db.delete(entry)
    db.commit()
    return None
