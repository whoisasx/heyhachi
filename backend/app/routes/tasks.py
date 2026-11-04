import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

from fastapi import APIRouter, Header, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.auth import CurrentUser
from app.errors import APIError, not_found
from app.models import TERMINAL_STATUSES, Task, TaskInput
from app.relay import Event
from app.runner import INPUT_KIND_FOR
from app.schemas import Accepted, TaskInputIn, TaskOut

router = APIRouter(tags=["tasks"])


async def _owned_task(request: Request, task_id: uuid.UUID, user_id: uuid.UUID) -> Task:
    async with request.app.state.session_factory() as session:
        task = await session.get(Task, task_id)
    if task is None or task.user_id != user_id:
        raise not_found()
    return task


@router.get("/tasks/{task_id}", response_model=TaskOut)
async def get_task(task_id: uuid.UUID, request: Request, user: CurrentUser) -> Task:
    return await _owned_task(request, task_id, user.id)


# ---- SSE ---------------------------------------------------------------


def _format(event: Event) -> str:
    data = json.dumps(event.payload, separators=(",", ":"))
    return f"id: {event.seq}\nevent: {event.type}\ndata: {data}\n\n"


def _is_terminal(event: Event) -> bool:
    return event.type == "status" and event.payload.get("status") in TERMINAL_STATUSES


@router.get("/tasks/{task_id}/events")
async def task_events(
    task_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    after: int | None = None,
    last_event_id: str | None = Header(default=None),
) -> StreamingResponse:
    task = await _owned_task(request, task_id, user.id)
    state = request.app.state
    try:
        start = int(last_event_id) if last_event_id else (after or 0)
    except ValueError:
        start = after or 0

    async def stream() -> AsyncIterator[str]:
        # Subscribe before reading history so nothing falls in between.
        with state.relay.subscribe(task_id) as queue:
            last = start
            for event in await state.store.events_after(task_id, last):
                yield _format(event)
                last = event.seq
                if _is_terminal(event):
                    return
            if task.status in TERMINAL_STATUSES and last >= task.last_event_seq:
                return
            while True:
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(
                        queue.get(), timeout=state.settings.sse_ping_interval
                    )
                except TimeoutError:
                    yield ": ping\n\n"
                    continue
                if event.seq <= last:
                    continue
                # A gap means the relay dropped events: fill it from Postgres.
                batch = (
                    [event]
                    if event.seq == last + 1
                    else await state.store.events_after(task_id, last)
                )
                for item in batch:
                    if item.seq <= last:
                        continue
                    yield _format(item)
                    last = item.seq
                    if _is_terminal(item):
                        return

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---- input and cancel ------------------------------------------------------


@router.post("/tasks/{task_id}/input", response_model=Accepted, status_code=202)
async def task_input(
    task_id: uuid.UUID, body: TaskInputIn, request: Request, user: CurrentUser
) -> Accepted:
    state = request.app.state
    task = await _owned_task(request, task_id, user.id)

    if body.kind == "otp":
        # OTP codes must be encrypted at rest; that arrives with the vault (phase 4.4).
        raise APIError(422, "validation_error", "OTP input is not available yet.")
    if body.secret is not None:
        raise APIError(422, "validation_error", "`secret` is only accepted for OTP input.")

    if task.status != "waiting_user":
        if task.error and task.error.get("code") == "waiting_timeout":
            raise APIError(410, "input_expired", "The wait timed out. Resume the task instead.")
        raise APIError(409, "task_not_waiting", "This task isn't waiting for input.")

    waiting = task.waiting_for or {}
    if waiting.get("card_seq") != body.card_seq:
        raise APIError(409, "stale_card", "That card is no longer active.")
    if datetime.fromisoformat(waiting["expires_at"]) <= datetime.now(UTC):
        raise APIError(410, "input_expired", "The wait timed out. Resume the task instead.")
    if INPUT_KIND_FOR[waiting["kind"]] != body.kind:
        raise APIError(
            422, "validation_error", f"This card expects `{INPUT_KIND_FOR[waiting['kind']]}`."
        )
    if body.kind == "confirm" and (body.data or {}).get("decision") not in ("approve", "reject"):
        raise APIError(422, "validation_error", "decision must be 'approve' or 'reject'.")
    if body.kind == "answer" and not str((body.data or {}).get("text", "")).strip():
        raise APIError(422, "validation_error", "Answer text is required.")

    async with state.session_factory() as session:
        already = await session.scalar(
            select(TaskInput.id).where(
                TaskInput.task_id == task_id,
                TaskInput.card_seq == body.card_seq,
                TaskInput.consumed_at.is_(None),
            )
        )
        if already is not None:
            return Accepted()  # duplicate submit; the first one wins
        task_input_row = TaskInput(
            id=uuid.uuid4(),
            task_id=task_id,
            user_id=user.id,
            kind=body.kind,
            card_seq=body.card_seq,
            data=body.data or {},
        )
        session.add(task_input_row)
        await session.commit()

    state.runner.deliver_input(task_id, body.card_seq, task_input_row.id, task_input_row.data)
    return Accepted()


@router.post("/tasks/{task_id}/cancel", response_model=Accepted, status_code=202)
async def cancel_task(task_id: uuid.UUID, request: Request, user: CurrentUser) -> Accepted:
    task = await _owned_task(request, task_id, user.id)
    if task.status in TERMINAL_STATUSES:
        raise APIError(409, "task_finished", "This task has already finished.")
    await request.app.state.runner.cancel(task_id)
    return Accepted()
