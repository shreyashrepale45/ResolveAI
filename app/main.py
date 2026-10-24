
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.auth import router as auth_router
from app.api.businesses import router as businesses_router
from app.api.conversations import router as conversations_router
from app.api.knowledge import router as knowledge_router
from app.db.session import engine


app = FastAPI(
    title="ResolveAI API",
    description="AI-powered customer support for small businesses",
    version="0.1.0",
)

# Allow the local React/Vite frontend to access the API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://resolve-ai-sandy.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routers.
app.include_router(auth_router)
app.include_router(businesses_router)
app.include_router(conversations_router)
app.include_router(knowledge_router)


@app.get("/")
def home():
    return {
        "project": "ResolveAI",
        "status": "running",
        "message": "Welcome to ResolveAI!",
    }


@app.get("/health/live")
def health_check():
    return {"status": "alive"}


@app.get("/health/ready")
def readiness_check():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

        return {
            "status": "ready",
            "database": "connected",
        }

    except SQLAlchemyError:
        raise HTTPException(
            status_code=503,
            detail="Database unavailable",
        )
