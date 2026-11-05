import uuid

from fastapi import APIRouter, Request, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.auth import CurrentUser
from app.errors import APIError, not_found
from app.models import ACTIVE_STATUSES, AuditLog, Conversation, Message, Task, TaskEvent
from app.schemas import (
    ConversationCreated,
    ConversationDetail,
    ConversationList,
    ConversationSummary,
    MessageAccepted,
    MessageOut,
    RenameConversation,
    SendMessage,
    TaskBrief,
    TaskRef,
)
from app.secret_scan import find_secret

router = APIRouter(tags=["conversations"])


async def _owned_conversation(session, conversation_id: uuid.UUID, user_id: uuid.UUID):
    conv = await session.get(Conversation, conversation_id)
    if conv is None or conv.user_id != user_id:
        raise not_found()
    return conv


def _task_ref(task: Task) -> TaskRef:
    return TaskRef(id=task.id, status=task.status, events_url=f"/v1/tasks/{task.id}/events")


@router.get("/conversations", response_model=ConversationList)
async def list_conversations(
    request: Request, user: CurrentUser, limit: int = 20, before: str | None = None
) -> ConversationList:
    limit = max(1, min(limit, 100))
    async with request.app.state.session_factory() as session:
        query = select(Conversation).where(Conversation.user_id == user.id)
        if before:
            query = query.where(Conversation.updated_at < func.to_timestamp(float(before)))
        convs = (
            await session.scalars(query.order_by(Conversation.updated_at.desc()).limit(limit + 1))
        ).all()
        page = convs[:limit]
        active = dict(
            (
                await session.execute(
                    select(Task.conversation_id, Task.id).where(
                        Task.conversation_id.in_([c.id for c in page]),
                        Task.status.in_(ACTIVE_STATUSES),
                    )
                )
            ).all()
        )
    items = [
        ConversationSummary(
            id=c.id, title=c.title, updated_at=c.updated_at, active_task_id=active.get(c.id)
        )
        for c in page
    ]
    next_cursor = str(page[-1].updated_at.timestamp()) if len(convs) > limit else None
    return ConversationList(items=items, next_cursor=next_cursor)


@router.post("/conversations", response_model=ConversationCreated, status_code=201)
async def create_conversation(request: Request, user: CurrentUser) -> Conversation:
    async with request.app.state.session_factory() as session:
        conv = Conversation(user_id=user.id)
        session.add(conv)
        await session.commit()
        await session.refresh(conv)
        return conv


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: uuid.UUID, request: Request, user: CurrentUser
) -> ConversationDetail:
    async with request.app.state.session_factory() as session:
        conv = await _owned_conversation(session, conversation_id, user.id)
        messages = (
            await session.scalars(
                select(Message)
                .where(Message.conversation_id == conv.id)
                .order_by(Message.created_at, Message.role.desc())
            )
        ).all()
        tasks = (
            await session.scalars(
                select(Task).where(Task.conversation_id == conv.id).order_by(Task.created_at)
            )
        ).all()
    return ConversationDetail(
        id=conv.id,
        title=conv.title,
        messages=[MessageOut.model_validate(m) for m in messages],
        tasks=[TaskBrief.model_validate(t) for t in tasks],
    )


@router.patch("/conversations/{conversation_id}", response_model=ConversationCreated)
async def rename_conversation(
    conversation_id: uuid.UUID, body: RenameConversation, request: Request, user: CurrentUser
) -> Conversation:
    title = " ".join(body.title.split())  # trim and collapse spaces
    if not title:
        raise APIError(422, "validation_error", "Give the chat a name.")
    async with request.app.state.session_factory() as session:
        conv = await _owned_conversation(session, conversation_id, user.id)
        conv.title = title
        await session.commit()
        await session.refresh(conv)
        return conv


@router.delete("/conversations/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: uuid.UUID, request: Request, user: CurrentUser
) -> Response:
    runner = request.app.state.runner
    async with request.app.state.session_factory() as session:
        conv = await _owned_conversation(session, conversation_id, user.id)
        active = (
            await session.scalars(
                select(Task.id).where(
                    Task.conversation_id == conv.id, Task.status.in_(ACTIVE_STATUSES)
                )
            )
        ).all()
    for task_id in active:
        await runner.cancel(task_id)
        await runner.wait_idle(task_id)
    async with request.app.state.session_factory() as session:
        conv = await session.get(Conversation, conversation_id)
        if conv is not None:
            await session.delete(conv)
            await session.commit()
    return Response(status_code=204)


@router.post(
    "/conversations/{conversation_id}/messages", response_model=MessageAccepted, status_code=202
)
async def send_message(
    conversation_id: uuid.UUID, body: SendMessage, request: Request, user: CurrentUser
) -> MessageAccepted:
    state = request.app.state
    content = body.content.strip()
    if not content:
        raise APIError(422, "validation_error", "Message is empty.")

    async with state.session_factory() as session:
        conv = await _owned_conversation(session, conversation_id, user.id)

        # Idempotent re-send: return what the first send created.
        existing = await session.scalar(
            select(Message).where(
                Message.conversation_id == conv.id,
                Message.client_message_id == body.client_message_id,
            )
        )
        if existing is not None:
            task = await session.get(Task, existing.task_id) if existing.task_id else None
            if task is None:
                raise APIError(409, "invalid_request", "This message has no task.")
            return MessageAccepted(
                message=MessageOut.model_validate(existing), task=_task_ref(task)
            )

        if not state.message_limiter.allow(str(user.id)):
            raise APIError(429, "rate_limited", "Too many messages, slow down a little.")

        secret_kind = find_secret(content)
        if secret_kind is not None:
            session.add(
                AuditLog(
                    user_id=user.id,
                    action="secret_pasted_in_chat",
                    metadata_={"detected": secret_kind, "conversation_id": str(conv.id)},
                )
            )
            await session.commit()
            raise APIError(
                422,
                "secret_in_message",
                "That looks like a secret. Use the secure input instead; it never enters the chat.",
                {"detected": secret_kind},
            )

        if await session.scalar(
            select(Task.id).where(Task.conversation_id == conv.id, Task.status.in_(ACTIVE_STATUSES))
        ):
            raise APIError(409, "task_in_progress", "Wait for the current task to finish.")
        active_count = await session.scalar(
            select(func.count()).where(Task.user_id == user.id, Task.status.in_(ACTIVE_STATUSES))
        )
        if active_count >= state.settings.max_active_tasks_per_user:
            raise APIError(429, "too_many_active_tasks", "You already have tasks running.")

        task = Task(
            id=uuid.uuid4(),
            user_id=user.id,
            conversation_id=conv.id,
            status="queued",
            last_event_seq=1,
        )
        message = Message(
            id=uuid.uuid4(),
            conversation_id=conv.id,
            role="user",
            content=content,
            task_id=task.id,
            client_message_id=body.client_message_id,
        )
        session.add(task)
        await session.flush()
        session.add_all(
            [
                message,
                TaskEvent(task_id=task.id, seq=1, type="status", payload={"status": "queued"}),
            ]
        )
        if conv.title is None:
            conv.title = content[:60]
        conv.updated_at = func.now()
        try:
            await session.commit()
        except IntegrityError as exc:
            # Concurrent re-send with the same client_message_id.
            raise APIError(409, "invalid_request", "Duplicate message, retry the request.") from exc
        await session.refresh(message)

    await state.runner.start(task.id)
    return MessageAccepted(
        message=MessageOut.model_validate(message),
        task=TaskRef(id=task.id, status="queued", events_url=f"/v1/tasks/{task.id}/events"),
    )
