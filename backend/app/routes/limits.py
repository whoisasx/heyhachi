"""The "too many tasks running" error, naming the tasks so the app can link to them."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import APIError
from app.models import ACTIVE_STATUSES, Conversation, Task


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
