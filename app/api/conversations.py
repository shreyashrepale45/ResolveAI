
import logging
from uuid import UUID
from typing import Literal
import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from collections import Counter


from app.api.dependencies import get_current_user
from app.db.session import get_db
from app.db.models.user import User
from app.db.models.business import Business
from app.db.models.membership import Membership
from app.db.models.conversation import Conversation
from app.services.gemini import generate_support_reply
from app.db.models.message import Message
from app.db.models.knowledge import KnowledgeEntry


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/businesses/{business_id}/conversations",
    tags=["Conversations"],
)


# Request and response schemas

class ConversationCreate(BaseModel):
    subject: str = Field(min_length=2, max_length=200)
    customer_name: str | None = Field(default=None, max_length=120)
    customer_email: str | None = Field(default=None, max_length=255)

class ConversationStatusUpdate(BaseModel):
    status: Literal["open", "resolved"]    


class ConversationPublic(BaseModel):
    id: str
    business_id: str
    subject: str
    customer_name: str | None
    customer_email: str | None
    status: str


class AIReplyRequest(BaseModel):
    message: str = Field(min_length=1, max_length=5000)


class AIReplyResponse(BaseModel):
    conversation_id: str
    customer_message: str
    ai_reply: str


class MessagePublic(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    created_at: str



# Business access verification

def verify_business_access(
    business_id: UUID,
    current_user: User,
    db: Session,
) -> Business:
    business = (
        db.query(Business)
        .join(
            Membership,
            Membership.business_id == Business.id,
        )
        .filter(
            Business.id == business_id,
            Membership.user_id == current_user.id,
        )
        .first()
    )

    if business is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Business not found or you do not have access to it.",
        )

    return business


# Create a conversation

@router.post(
    "/",
    response_model=ConversationPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_conversation(
    business_id: UUID,
    data: ConversationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    business = verify_business_access(
        business_id,
        current_user,
        db,
    )

    conversation = Conversation(
        business_id=business.id,
        subject=data.subject.strip(),
        customer_name=data.customer_name,
        customer_email=(
            str(data.customer_email).strip().lower()
            if data.customer_email
            else None
        ),
    )

    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    return ConversationPublic(
        id=str(conversation.id),
        business_id=str(conversation.business_id),
        subject=conversation.subject,
        customer_name=conversation.customer_name,
        customer_email=conversation.customer_email,
        status=conversation.status,
    )


# List conversations

@router.get(
    "/",
    response_model=list[ConversationPublic],
)
def list_conversations(
    business_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    verify_business_access(
        business_id,
        current_user,
        db,
    )

    conversations = (
        db.query(Conversation)
        .filter(
            Conversation.business_id == business_id,
        )
        .order_by(Conversation.created_at.desc())
        .all()
    )

    return [
        ConversationPublic(
            id=str(conversation.id),
            business_id=str(conversation.business_id),
            subject=conversation.subject,
            customer_name=conversation.customer_name,
            customer_email=conversation.customer_email,
            status=conversation.status,
        )
        for conversation in conversations
    ]



@router.patch(
    "/{conversation_id}/status",
    response_model=ConversationPublic,
)
def update_conversation_status(
    business_id: UUID,
    conversation_id: UUID,
    data: ConversationStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    business = verify_business_access(
        business_id,
        current_user,
        db,
    )

    conversation = (
        db.query(Conversation)
        .filter(
            Conversation.id == conversation_id,
            Conversation.business_id == business.id,
        )
        .first()
    )

    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found.",
        )

    conversation.status = data.status

    try:
        db.commit()
        db.refresh(conversation)
    except Exception as exc:
        db.rollback()
        logger.exception("Failed to update conversation status.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not update conversation status.",
        ) from exc

    return ConversationPublic(
        id=str(conversation.id),
        business_id=str(conversation.business_id),
        subject=conversation.subject,
        customer_name=conversation.customer_name,
        customer_email=conversation.customer_email,
        status=conversation.status,
    )



# Generate an AI reply for a conversation



@router.post(
    "/{conversation_id}/reply",
    response_model=AIReplyResponse,
)
def generate_conversation_reply(
    business_id: UUID,
    conversation_id: UUID,
    data: AIReplyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    business = verify_business_access(
        business_id,
        current_user,
        db,
    )

    conversation = (
        db.query(Conversation)
        .filter(
            Conversation.id == conversation_id,
            Conversation.business_id == business.id,
        )
        .first()
    )

    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found.",
        )

    customer_message = data.message.strip()

    if not customer_message:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Message cannot be empty.",
        )

    # Load previous messages before adding the latest customer message.
    previous_messages = (
        db.query(Message)
        .filter(
            Message.conversation_id == conversation.id,
        )
        .order_by(Message.created_at.asc(), Message.id.asc())
        .all()
    )

    conversation_history = [
        {
            "role": message.role,
            "content": message.content,
        }
        for message in previous_messages
    ]


    knowledge_entries = (
        db.query(KnowledgeEntry)
        .filter(KnowledgeEntry.business_id == business.id)
        .order_by(KnowledgeEntry.created_at.desc())
        .limit(200)
        .all()
    )

    # Remove common words that do not help identify the topic.
    stop_words = {
        "a", "an", "the", "is", "are", "am", "i", "we", "you",
        "me", "my", "our", "your", "can", "could", "would",
        "do", "does", "did", "how", "what", "when", "where",
        "who", "why", "to", "for", "of", "in", "on", "at",
        "and", "or", "it", "this", "that", "within", "please",
        "product", "business", "customer", "days",
    }


    synonym_groups = [
        {"return", "refund", "money", "back", "reimburse", "reimbursement"},
        {"delivery", "shipping", "shipment", "deliver"},
        {"cancel", "cancellation", "cancelled", "canceled"},
        {"payment", "pay", "paid", "billing", "charge"},
        {"discount", "offer", "promotion", "coupon", "deal"},
        {"order", "purchase", "bought", "buy"},
        {"broken", "damaged", "defective", "faulty"},
        {"track", "tracking", "status", "shipment"},
    ]

    synonym_lookup = {
        word: group
        for group in synonym_groups
        for word in group
    }

    def get_keywords(text: str) -> set[str]:
        words = re.findall(r"[a-z0-9]+", text.lower())
        keywords = {
            word for word in words
            if len(word) > 1 and word not in stop_words
        }

        expanded_keywords = set(keywords)

        for word in keywords:
            expanded_keywords.update(synonym_lookup.get(word, {word}))

        return expanded_keywords

    question_keywords = get_keywords(customer_message)

    scored_entries = []

    for entry in knowledge_entries:
        title_keywords = get_keywords(entry.title or "")
        content_keywords = get_keywords(entry.content or "")

        
        title_matches = question_keywords & title_keywords
        content_matches = question_keywords & content_keywords

        # Strong title matches are more important than body matches.
        score = (
            len(title_matches) * 5
            + len(content_matches)
        )

        # Ignore entries with no meaningful keyword overlap.
        if len(title_matches) == 0 and len(content_matches) < 2:
            continue


        if score > 0:
            scored_entries.append(
                (
                    score,
                    entry.created_at,
                    {
                        "title": entry.title,
                        "content": entry.content,
                    },
                )
            )

    # Highest relevance first; use newest entries to break ties.
    scored_entries.sort(
        key=lambda item: (item[0], item[1]),
        reverse=True,
    )

    # Pass only the five most relevant entries to Gemini.
    business_knowledge = [
        item[2] for item in scored_entries[:5]
    ]


    try:
        
        ai_reply = generate_support_reply(
            customer_message=customer_message,
            business_name=business.name,
            conversation_history=conversation_history,
            business_knowledge=business_knowledge,
        )

    except RuntimeError as exc:
        logger.error("Gemini reply generation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected AI reply generation error.")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="An unexpected error occurred while generating the AI reply.",
        ) from exc

    try:
        customer_record = Message(
            conversation_id=conversation.id,
            role="customer",
            content=customer_message,
        )

        assistant_record = Message(
            conversation_id=conversation.id,
            role="assistant",
            content=ai_reply,
        )

        db.add_all([customer_record, assistant_record])
        db.commit()

    except Exception as exc:
        db.rollback()
        logger.exception("Failed to save conversation messages.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="The AI reply was generated but could not be saved.",
        ) from exc

    return AIReplyResponse(
        conversation_id=str(conversation.id),
        customer_message=customer_message,
        ai_reply=ai_reply,
    )


@router.get(
    "/{conversation_id}/messages",
    response_model=list[MessagePublic],
)
def list_conversation_messages(
    business_id: UUID,
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    business = verify_business_access(
        business_id,
        current_user,
        db,
    )

    conversation = (
        db.query(Conversation)
        .filter(
            Conversation.id == conversation_id,
            Conversation.business_id == business.id,
        )
        .first()
    )

    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found.",
        )

    messages = (
        db.query(Message)
        .filter(
            Message.conversation_id == conversation.id,
        )
        .order_by(Message.created_at.asc(), Message.id.asc())
        .all()
    )

    return [
        MessagePublic(
            id=str(message.id),
            conversation_id=str(message.conversation_id),
            role=message.role,
            content=message.content,
            created_at=message.created_at.isoformat(),
        )
        for message in messages
    ]


@router.get("/analytics")
def get_conversation_analytics(
    business_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    business = verify_business_access(
        business_id,
        current_user,
        db,
    )

    conversations = (
        db.query(Conversation)
        .filter(Conversation.business_id == business.id)
        .all()
    )

    total = len(conversations)
    resolved = sum(
        1
        for conversation in conversations
        if str(conversation.status).lower() == "resolved"
    )
    open_count = total - resolved

    subjects = Counter(
        (conversation.subject or "Other inquiries").strip()
        for conversation in conversations
    )

    return {
        "total_conversations": total,
        "open_conversations": open_count,
        "resolved_conversations": resolved,
        "resolution_rate": round(
            resolved / total * 100, 2
        ) if total else 0,
        "top_subjects": [
            {"subject": subject, "count": count}
            for subject, count in subjects.most_common(5)
        ],
    }

