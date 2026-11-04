from fastapi import APIRouter

from app.auth import CurrentUser
from app.models import User
from app.schemas import UserOut

router = APIRouter(tags=["users"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> User:
    return user
