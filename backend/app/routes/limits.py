"""Per-user limits: tasks running at once, and spend per day."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import APIError
from app.models import ACTIVE_STATUSES, Conversation, Task

DAILY_LIMIT_MESSAGE = (
    "You've used today's ${limit:.0f} spending limit. You can start new tasks again tomorrow."
)


async def spent_today(session: AsyncSession, user_id: uuid.UUID) -> float:
    """What the user's tasks have cost in the last 24 hours."""
    since = datetime.now(UTC) - timedelta(hours=24)
    total = await session.scalar(
        select(func.coalesce(func.sum(Task.cost_usd), 0)).where(
            Task.user_id == user_id, Task.created_at >= since
        )
    )
    return float(total)


async def check_daily_limit(session: AsyncSession, user_id: uuid.UUID, limit: float) -> None:
    """Refuse a new task once the user has spent their daily limit."""
    spent = await spent_today(session, user_id)
    if spent >= limit:
        raise APIError(
            429,
            "daily_limit",
            DAILY_LIMIT_MESSAGE.format(limit=limit),
            {"spent_usd": round(spent, 2), "limit_usd": limit},
        )


async def too_many_tasks(session: AsyncSession, user_id: uuid.UUID) -> APIError:
    rows = (
        await session.execute(
            select(Task.id, Task.conversation_id, Conversation.title)
            .join(Conversation, Conversation.id == Task.conversation_id)
            .where(Task.user_id == user_id, Task.status.in_(ACTIVE_STATUSES))
            .order_by(Task.created_at)
        )
    ).all()
    running = [
        {"task_id": str(t), "conversation_id": str(c), "title": title or "Untitled chat"}
        for t, c, title in rows
    ]
    return APIError(
        429,
        "too_many_active_tasks",
        "You already have tasks running. Wait for one to finish, or stop it.",
        {"running": running},
    )
