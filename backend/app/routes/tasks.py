import asyncio
import json
import re
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Header, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from app.auth import CurrentUser
from app.crypto import Sealed
from app.errors import APIError, not_found
from app.events import LostOwnership
from app.models import ACTIVE_STATUSES, TERMINAL_STATUSES, Task, TaskInput
from app.relay import Event
from app.routes.limits import check_daily_limit, too_many_tasks
from app.runner import INPUT_KIND_FOR
from app.schemas import Accepted, RetryIn, TaskInputIn, TaskOut, TaskRef

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
            history = await state.store.events_after(task_id, last)
            for event in history:
                yield _format(event)
                last = event.seq
            # A resumed task has a "failed" in its history, so only the latest event counts.
            if history and _is_terminal(history[-1]):
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


OTP_RE = re.compile(r"\d{4,8}")


def check_waiting(task: Task, card_seq: int, kind: str) -> dict:
    """Raise unless `task` is waiting on card `card_seq` that expects input `kind`."""
    if task.status != "waiting_user":
        if task.error and task.error.get("code") == "waiting_timeout":
            raise APIError(410, "input_expired", "The wait timed out. Resume the task instead.")
        raise APIError(409, "task_not_waiting", "This task isn't waiting for input.")
    waiting = task.waiting_for or {}
    if waiting.get("card_seq") != card_seq:
        raise APIError(409, "stale_card", "That card is no longer active.")
    if datetime.fromisoformat(waiting["expires_at"]) <= datetime.now(UTC):
        raise APIError(410, "input_expired", "The wait timed out. Resume the task instead.")
    if INPUT_KIND_FOR[waiting["kind"]] != kind:
        raise APIError(
            422, "validation_error", f"This card expects `{INPUT_KIND_FOR[waiting['kind']]}`."
        )
    return waiting


async def store_input(
    state: Any,
    task: Task,
    user_id: uuid.UUID,
    *,
    kind: str,
    card_seq: int,
    data: dict | None,
    sealed: Sealed | None = None,
) -> None:
    """Save the user's answer and wake the waiting task. Duplicate submits are ignored."""
    async with state.session_factory() as session:
        already = await session.scalar(
            select(TaskInput.id).where(
                TaskInput.task_id == task.id,
                TaskInput.card_seq == card_seq,
                TaskInput.consumed_at.is_(None),
            )
        )
        if already is not None:
            return  # the first one wins
        row = TaskInput(
            id=uuid.uuid4(),
            task_id=task.id,
            user_id=user_id,
            kind=kind,
            card_seq=card_seq,
            data=data or {},
            **(sealed.columns() if sealed else {}),
        )
        session.add(row)
        await session.commit()
    state.runner.deliver_input(task.id, card_seq, row.id, row.data)


@router.post("/tasks/{task_id}/input", response_model=Accepted, status_code=202)
async def task_input(
    task_id: uuid.UUID, body: TaskInputIn, request: Request, user: CurrentUser
) -> Accepted:
    state = request.app.state
    task = await _owned_task(request, task_id, user.id)

    if body.kind != "otp" and body.secret is not None:
        raise APIError(422, "validation_error", "`secret` is only accepted for OTP input.")
    waiting = check_waiting(task, body.card_seq, body.kind)
    if body.kind == "confirm" and (body.data or {}).get("decision") not in ("approve", "reject"):
        raise APIError(422, "validation_error", "decision must be 'approve' or 'reject'.")
    if body.kind == "answer" and not str((body.data or {}).get("text", "")).strip():
        raise APIError(422, "validation_error", "Answer text is required.")

    sealed = None
    data = body.data
    if body.kind == "otp":
        code = (body.secret or "").strip()
        if not OTP_RE.fullmatch(code):
            raise APIError(422, "validation_error", "The code should be 4-8 digits.")
        # Encrypted at rest, bound to this user + the task's site; wiped once used.
        sealed = state.vault.seal(
            {"code": code}, user_id=user.id, site=waiting.get("site") or "", kind="otp"
        )
        data = {}

    await store_input(
        state, task, user.id, kind=body.kind, card_seq=body.card_seq, data=data, sealed=sealed
    )
    return Accepted()


@router.post("/tasks/{task_id}/cancel", response_model=Accepted, status_code=202)
async def cancel_task(task_id: uuid.UUID, request: Request, user: CurrentUser) -> Accepted:
    task = await _owned_task(request, task_id, user.id)
    if task.status in TERMINAL_STATUSES:
        raise APIError(409, "task_finished", "This task has already finished.")
    await request.app.state.runner.cancel(task_id)
    return Accepted()


# ---- retry ---------------------------------------------------------------

# Limits and repeated crashes: resuming would hit the same wall, so only restart.
RESTART_ONLY = {"step_limit", "time_limit", "cost_limit", "too_many_attempts"}


@router.post("/tasks/{task_id}/retry", response_model=TaskRef, status_code=202)
async def retry_task(
    task_id: uuid.UUID, body: RetryIn, request: Request, user: CurrentUser
) -> TaskRef:
    state = request.app.state
    task = await _owned_task(request, task_id, user.id)
    if task.status not in ("failed", "cancelled"):
        raise APIError(409, "task_not_retryable", "Only a failed or cancelled task can be retried.")
    error = task.error or {}
    if not error.get("retryable", task.status == "cancelled"):
        raise APIError(409, "task_not_retryable", "This task can't be retried.")
    if body.mode == "resume" and (task.status != "failed" or error.get("code") in RESTART_ONLY):
        raise APIError(409, "task_not_resumable", "This task can't be resumed; start it over.")

    async with state.session_factory() as session:
        if await session.scalar(
            select(Task.id).where(
                Task.conversation_id == task.conversation_id, Task.status.in_(ACTIVE_STATUSES)
            )
        ):
            raise APIError(409, "task_in_progress", "Wait for the current task to finish.")
        active = await session.scalar(
            select(func.count()).where(Task.user_id == user.id, Task.status.in_(ACTIVE_STATUSES))
        )
        if active >= state.settings.max_active_tasks_per_user:
            raise await too_many_tasks(session, user.id)
        await check_daily_limit(session, user.id, state.settings.max_cost_per_user_day_usd)

    try:
        if body.mode == "resume":
            await state.runner.resume(task_id)
            new_id = task_id
        else:
            new_id = await state.runner.restart(task_id)
    except LostOwnership as exc:  # retried twice at once
        raise APIError(409, "task_not_retryable", "This task was already retried.") from exc
    return TaskRef(id=new_id, status="queued", events_url=f"/v1/tasks/{new_id}/events")
