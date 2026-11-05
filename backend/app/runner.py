"""Task runner: one asyncio task per user request (docs/ARCHITECTURE.md §4.3, §5, §9).

- `start()` claims a task and runs `executor.run(ctx)` in the background.
- `TaskContext` is the only way an executor changes task state or talks to the user.
- A single heartbeat loop marks every owned task alive.
- `recover()` runs on startup and resumes or fails tasks left unfinished by a dead process.
- A watchdog fails a task that has been *working* (not waiting for the user) too long.
- `resume()` / `restart()` back the Retry card (docs/API.md `POST /tasks/{id}/retry`).
"""

import asyncio
import logging
import os
import socket
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any, Protocol

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.events import EventSpec, EventStore, LostOwnership
from app.models import (
    ACTIVE_STATUSES,
    TERMINAL_STATUSES,
    BrowserSession,
    Conversation,
    Credential,
    Message,
    Task,
    TaskEvent,
    TaskInput,
)
from app.secret_scan import find_secret

if TYPE_CHECKING:
    from app.crypto import Vault

log = logging.getLogger(__name__)

# What the user answers for each kind of card.
INPUT_KIND_FOR = {
    "otp": "otp",
    "confirm": "confirm",
    "question": "answer",
    "credential": "credential_ready",
}


def answer_note(kind: str, data: dict[str, Any] | None) -> str:
    """A short, secret-free note of what the user answered, kept in the chat's history."""
    data = data or {}
    if kind == "confirm":
        return "Approved" if data.get("decision") == "approve" else "Declined"
    if kind == "otp":
        return "Code sent"
    if kind == "credential":
        return "Login details saved" if data.get("kind") == "password" else "Connected"
    text = " ".join(str(data.get("text", "")).split())
    if not text or find_secret(text):
        return "Answered"
    return text if len(text) <= 80 else text[:79] + "…"


def make_worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}:{int(time.time())}"


class WaitingTimeout(Exception):
    pass


class TaskFailed(Exception):
    """Raise from an executor to fail the task with a specific error code."""

    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class Executor(Protocol):
    async def run(self, ctx: "TaskContext") -> None: ...


@dataclass
class _Waiter:
    card_seq: int
    future: asyncio.Future


class TaskContext:
    """Handle an executor uses to report progress, wait for the user, and finish."""

    def __init__(self, runner: "TaskRunner", task: Task, request_text: str) -> None:
        self._runner = runner
        self.task_id: uuid.UUID = task.id
        self.user_id: uuid.UUID = task.user_id
        self.conversation_id: uuid.UUID = task.conversation_id
        self.request_text = request_text
        self.checkpoint: dict[str, Any] = dict(task.checkpoint or {})
        self.attempt: int = task.attempt
        self.status: str = task.status
        self.waiting_for: dict[str, Any] | None = task.waiting_for
        self.markers: dict[str, Any] = dict(task.markers or {})
        self.finished = False
        # Working time = wall time minus time spent waiting for the user.
        self._started = time.monotonic()
        self._waited = 0.0
        self._wait_began: float | None = None

    def working_seconds(self) -> float:
        waiting = time.monotonic() - self._wait_began if self._wait_began is not None else 0.0
        return time.monotonic() - self._started - self._waited - waiting

    @property
    def session_factory(self):
        return self._runner.session_factory

    @property
    def _store(self) -> EventStore:
        return self._runner.store

    async def _apply(self, events: list[EventSpec], **kwargs: Any) -> list:
        return await self._store.apply(
            self.task_id, worker_id=self._runner.worker_id, events=events, **kwargs
        )

    def use_site(self, site: str) -> None:
        """Record that this task is using `site`, so revoking it stops the task."""
        entry = self._runner._sites_in_use.setdefault(self.task_id, (self.user_id, set()))
        entry[1].add(site)

    async def progress(self, text: str) -> None:
        await self._apply([("progress", {"text": text})])

    async def emit(self, etype: str, payload: dict[str, Any]) -> None:
        await self._apply([(etype, payload)])

    async def set_status(self, status: str) -> None:
        if status not in ("running", "verifying"):
            raise ValueError(f"executors may only set running/verifying, not {status}")
        if status == self.status:
            return
        await self._apply([("status", {"status": status})], changes={"status": status})
        self.status = status

    async def set_marker(self, key: str, value: dict[str, Any]) -> None:
        """Record an irreversible action's state (approved / started / done / unknown).

        Written before and after the action, so a crash in between is detectable
        (docs/ARCHITECTURE.md §9.1 rule 4).
        """
        markers = {**self.markers, key: value}
        await self._apply([], changes={"markers": markers})
        self.markers = markers

    async def save_checkpoint(self, checkpoint: dict[str, Any]) -> None:
        await self._apply([], changes={"checkpoint": checkpoint})
        self.checkpoint = dict(checkpoint)

    async def add_cost(self, usd: float) -> float:
        """Add spend to the task and enforce the per-task cost limit. Returns the new total."""
        async with self._runner.session_factory() as session, session.begin():
            total = await session.scalar(
                update(Task)
                .where(Task.id == self.task_id, Task.worker_id == self._runner.worker_id)
                .values(cost_usd=Task.cost_usd + usd)
                .returning(Task.cost_usd)
            )
        if total is None:
            raise LostOwnership(str(self.task_id))
        if float(total) > self._runner.settings.max_cost_per_task_usd:
            raise TaskFailed("cost_limit", "This task hit its spending limit.", retryable=True)
        return float(total)

    async def history(self, limit: int = 20) -> list[dict[str, Any]]:
        """Earlier chat turns in this conversation (oldest first), excluding this task's.

        Assistant replies carry their task's checkpoint (`checkpoint`), so the
        orchestrator can note which tools produced them.
        """
        async with self._runner.session_factory() as session:
            rows = (
                await session.execute(
                    select(Message.role, Message.content, Message.task_id)
                    .where(
                        Message.conversation_id == self.conversation_id,
                        (Message.task_id != self.task_id) | Message.task_id.is_(None),
                    )
                    .order_by(Message.created_at.desc())
                    .limit(limit)
                )
            ).all()
            task_ids = {r.task_id for r in rows if r.role == "assistant" and r.task_id}
            checkpoints: dict[uuid.UUID, Any] = {}
            if task_ids:
                checkpoints = dict(
                    (
                        await session.execute(
                            select(Task.id, Task.checkpoint).where(Task.id.in_(task_ids))
                        )
                    ).all()
                )
        out: list[dict[str, Any]] = []
        for r in reversed(rows):
            turn: dict[str, Any] = {"role": r.role, "content": r.content}
            if r.role == "assistant" and checkpoints.get(r.task_id):
                turn["checkpoint"] = checkpoints[r.task_id]
            out.append(turn)
        return out

    async def connected_accounts(self) -> list[dict[str, Any]]:
        """Metadata of the user's stored access (never values)."""
        async with self._runner.session_factory() as session:
            creds = (
                await session.execute(
                    select(Credential.site, Credential.kind, Credential.label).where(
                        Credential.user_id == self.user_id
                    )
                )
            ).all()
            sessions = (
                await session.execute(
                    select(BrowserSession.site, BrowserSession.status).where(
                        BrowserSession.user_id == self.user_id
                    )
                )
            ).all()
        sites: dict[str, dict[str, Any]] = {}
        for site, kind, label in creds:
            sites.setdefault(site, {"site": site, "credentials": [], "session": None})
            sites[site]["credentials"].append({"kind": kind, "label": label})
        for site, status in sessions:
            sites.setdefault(site, {"site": site, "credentials": [], "session": None})
            sites[site]["session"] = status
        return sorted(sites.values(), key=lambda s: s["site"])

    async def ask(
        self, kind: str, card: dict[str, Any], wait_seconds: float | None = None
    ) -> dict[str, Any]:
        """Show a card and wait for the user's answer. Returns the input's `data`.

        If the task is already waiting on a card of this kind (resumed after a
        crash), the same card is reused instead of showing a new one.
        """
        if kind not in INPUT_KIND_FOR:
            raise ValueError(f"unknown card kind {kind}")
        if wait_seconds is None:
            wait_seconds = self._runner.settings.waiting_timeout

        if self.status == "waiting_user" and self.waiting_for and self.waiting_for["kind"] == kind:
            card_seq = int(self.waiting_for["card_seq"])
            expires_at = datetime.fromisoformat(self.waiting_for["expires_at"])
        else:
            expires_at = datetime.now(UTC) + timedelta(seconds=wait_seconds)

            def waiting(seqs: list[int]) -> dict[str, Any]:
                return {
                    "status": "waiting_user",
                    "waiting_for": {
                        "kind": kind,
                        "site": card.get("site"),
                        "card_seq": seqs[1],
                        "expires_at": expires_at.isoformat(),
                    },
                }

            events = await self._apply(
                [("status", {"status": "waiting_user"}), ("card", {"kind": kind, **card})],
                changes_from_seqs=waiting,
            )
            card_seq = events[1].seq
            self.status = "waiting_user"
            self.waiting_for = {
                "kind": kind,
                "site": card.get("site"),
                "card_seq": card_seq,
                "expires_at": expires_at.isoformat(),
            }

        site = (self.waiting_for or {}).get("site") or ""
        self._wait_began = time.monotonic()
        try:
            input_id, data = await self._runner._wait_for_input(self.task_id, card_seq, expires_at)
        finally:
            self._waited += time.monotonic() - self._wait_began
            self._wait_began = None
        if kind == "otp":  # decrypted only here, in memory; the stored copy is wiped below
            data = {"code": await self._runner.read_otp(input_id, self.user_id, site)}

        async def consume(session: AsyncSession) -> None:
            values: dict[str, Any] = {"consumed_at": func.now()}
            if kind == "otp":
                values.update(ciphertext=None, nonce=None, encrypted_dek=None, dek_nonce=None)
            await session.execute(
                update(TaskInput).where(TaskInput.id == input_id).values(**values)
            )

        await self._apply(
            [
                (
                    "card_resolved",
                    {
                        "card_seq": card_seq,
                        "outcome": "submitted",
                        "answer": answer_note(kind, data),
                    },
                ),
                ("status", {"status": "running"}),
            ],
            changes={"status": "running", "waiting_for": None},
            extra=consume,
        )
        self.status = "running"
        self.waiting_for = None
        return data or {}

    async def finish(self, reply: str, result: dict[str, Any] | None = None) -> None:
        """Mark the task done and post the assistant's final reply."""
        message_id = uuid.uuid4()

        async def add_reply(session: AsyncSession) -> None:
            session.add(
                Message(
                    id=message_id,
                    conversation_id=self.conversation_id,
                    role="assistant",
                    content=reply,
                    task_id=self.task_id,
                )
            )
            await session.execute(
                update(Conversation)
                .where(Conversation.id == self.conversation_id)
                .values(updated_at=func.now())
            )

        await self._apply(
            [
                ("reply", {"text": reply, "message_id": str(message_id)}),
                ("status", {"status": "done"}),
            ],
            changes={
                "status": "done",
                "waiting_for": None,
                "result": result,
                "worker_id": None,
                "finished_at": func.now(),
            },
            extra=add_reply,
        )
        self.status = "done"
        self.finished = True


class TaskRunner:
    def __init__(
        self,
        store: EventStore,
        executor: Executor,
        settings: Settings,
        vault: "Vault | None" = None,
    ) -> None:
        self.store = store
        self.vault = vault
        self.session_factory = store.session_factory
        self.executor = executor
        self.settings = settings
        self.worker_id = make_worker_id()
        self._tasks: dict[uuid.UUID, asyncio.Task] = {}
        self._waiters: dict[uuid.UUID, _Waiter] = {}
        self._cancel_requested: set[uuid.UUID] = set()
        self._cancel_errors: dict[uuid.UUID, dict[str, Any]] = {}  # cancel = fail with this
        self._sites_in_use: dict[uuid.UUID, tuple[uuid.UUID, set[str]]] = {}
        self._heartbeat: asyncio.Task | None = None

    # ---- lifecycle -------------------------------------------------------

    async def startup(self) -> None:
        await self.recover()
        self._heartbeat = asyncio.create_task(self._heartbeat_loop(), name="heartbeat")

    async def shutdown(self) -> None:
        """Stop without changing task state; unfinished tasks are recovered on next start."""
        if self._heartbeat:
            self._heartbeat.cancel()
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(
            *tasks, *([self._heartbeat] if self._heartbeat else []), return_exceptions=True
        )

    def is_running(self, task_id: uuid.UUID) -> bool:
        return task_id in self._tasks

    async def wait_idle(self, task_id: uuid.UUID) -> None:
        task = self._tasks.get(task_id)
        if task is not None:
            await asyncio.gather(task, return_exceptions=True)

    # ---- starting and recovering -----------------------------------------

    async def start(self, task_id: uuid.UUID) -> bool:
        """Claim the task for this process and run it in the background."""
        if task_id in self._tasks:
            return False
        async with self.session_factory() as session, session.begin():
            row = await session.execute(
                update(Task)
                .where(Task.id == task_id, Task.status.in_(ACTIVE_STATUSES))
                .values(
                    worker_id=self.worker_id,
                    attempt=Task.attempt + 1,
                    heartbeat_at=func.now(),
                    started_at=func.coalesce(Task.started_at, func.now()),
                )
                .returning(Task)
            )
            task = row.scalar_one_or_none()
            if task is None:
                return False
            request_text = await session.scalar(
                select(Message.content).where(Message.task_id == task_id, Message.role == "user")
            )

        resumed = task.attempt > 1
        if task.status in ("queued", "running", "verifying"):
            events: list[EventSpec] = []
            if task.status != "running":
                events.append(("status", {"status": "running"}))
            if resumed:
                events.append(("progress", {"text": "Hit a hiccup, picking up where I left off"}))
            if events:
                await self.store.apply(
                    task_id, worker_id=self.worker_id, events=events, changes={"status": "running"}
                )
            task.status = "running"

        ctx = TaskContext(self, task, request_text or "")
        self._tasks[task_id] = asyncio.create_task(self._run(ctx), name=f"task-{task_id}")
        return True

    async def recover(self) -> None:
        """Resume (or give up on) tasks a previous process left unfinished."""
        async with self.session_factory() as session:
            rows = (
                await session.execute(
                    select(Task.id, Task.attempt).where(Task.status.in_(ACTIVE_STATUSES))
                )
            ).all()
        for task_id, attempt in rows:
            if task_id in self._tasks:
                continue
            if attempt >= self.settings.max_attempts:
                await self._finalize(
                    task_id,
                    worker_id=None,
                    status="failed",
                    error={
                        "code": "too_many_attempts",
                        "message": "This task was interrupted too many times.",
                        "retryable": True,
                    },
                )
            else:
                await self.start(task_id)

    # ---- running ---------------------------------------------------------

    async def _watchdog(self, ctx: TaskContext) -> None:
        """Fail the task once its working time (waiting not counted) passes the limit."""
        limit = self.settings.max_task_seconds
        while True:
            await asyncio.sleep(min(self.settings.watchdog_interval, limit))
            if ctx.working_seconds() > limit:
                task = self._tasks.get(ctx.task_id)
                if task is not None:
                    self._cancel_errors[ctx.task_id] = {
                        "code": "time_limit",
                        "message": "This task took too long, so I stopped it.",
                        "retryable": True,
                    }
                    task.cancel()
                return

    async def _run(self, ctx: TaskContext) -> None:
        task_id = ctx.task_id
        watchdog = asyncio.create_task(self._watchdog(ctx), name=f"watchdog-{task_id}")
        try:
            await self.executor.run(ctx)
            if not ctx.finished:
                raise RuntimeError("executor returned without finishing the task")
        except asyncio.CancelledError:
            if task_id in self._cancel_errors:
                await self._finalize_safely(
                    task_id, status="failed", error=self._cancel_errors[task_id]
                )
            elif task_id in self._cancel_requested:
                await self._finalize_safely(task_id, status="cancelled")
            else:
                raise  # shutdown: leave state as is for recovery
        except LostOwnership:
            log.info("task %s: lost ownership, stopping", task_id)
        except WaitingTimeout:
            await self._finalize_safely(
                task_id,
                status="failed",
                card_outcome="expired",
                error={
                    "code": "waiting_timeout",
                    "message": "I paused because I needed your input.",
                    "retryable": True,
                },
            )
        except TaskFailed as exc:
            await self._finalize_safely(
                task_id,
                status="failed",
                error={"code": exc.code, "message": exc.message, "retryable": exc.retryable},
            )
        except Exception:
            log.exception("task %s crashed", task_id)
            await self._finalize_safely(
                task_id,
                status="failed",
                error={
                    "code": "internal_error",
                    "message": "Something went wrong.",
                    "retryable": True,
                },
            )
        finally:
            watchdog.cancel()
            self._tasks.pop(task_id, None)
            self._waiters.pop(task_id, None)
            self._cancel_requested.discard(task_id)
            self._cancel_errors.pop(task_id, None)
            self._sites_in_use.pop(task_id, None)

    async def _finalize_safely(self, task_id: uuid.UUID, **kwargs: Any) -> None:
        try:
            await self._finalize(task_id, worker_id=self.worker_id, **kwargs)
        except LostOwnership:
            log.info("task %s: lost ownership while finalizing", task_id)

    async def _finalize(
        self,
        task_id: uuid.UUID,
        *,
        worker_id: str | None,
        status: str,
        error: dict[str, Any] | None = None,
        card_outcome: str | None = None,
    ) -> None:
        """Move a task to a terminal status, resolving any open card."""
        assert status in TERMINAL_STATUSES
        async with self.session_factory() as session:
            waiting_for = await session.scalar(select(Task.waiting_for).where(Task.id == task_id))
        events: list[EventSpec] = []
        if waiting_for:
            outcome = card_outcome or ("cancelled" if status == "cancelled" else "expired")
            events.append(
                ("card_resolved", {"card_seq": waiting_for["card_seq"], "outcome": outcome})
            )
        if error:
            events.append(("error", error))
        events.append(("status", {"status": status}))
        await self.store.apply(
            task_id,
            worker_id=worker_id,
            events=events,
            only_if_status_in=ACTIVE_STATUSES,
            changes={
                "status": status,
                "waiting_for": None,
                "error": error,
                "worker_id": None,
                "finished_at": func.now(),
            },
        )

    # ---- retry -----------------------------------------------------------

    async def resume(self, task_id: uuid.UUID) -> None:
        """Continue a failed task from its checkpoint (same task, same events).

        The attempt counter starts over; markers are kept, so an irreversible
        action that was in flight is checked on the site, never repeated blindly.
        """
        await self.store.apply(
            task_id,
            worker_id=None,
            only_if_status_in=("failed",),
            events=[("progress", {"text": "Resuming"}), ("status", {"status": "queued"})],
            changes={
                "status": "queued",
                "error": None,
                "waiting_for": None,
                "finished_at": None,
                "attempt": 0,
            },
        )
        await self.start(task_id)

    async def restart(self, task_id: uuid.UUID) -> uuid.UUID:
        """Start a new task for the same user message, ignoring the old checkpoint.

        The user's message moves to the new task. Markers of actions that were
        started but never confirmed done carry over, so they get checked first.
        """
        new_id = uuid.uuid4()
        async with self.session_factory() as session, session.begin():
            old = await session.get(Task, task_id, with_for_update=True)
            if old is None or old.status not in ("failed", "cancelled"):
                raise LostOwnership(str(task_id))
            carried = {
                key: {**value, "carried_from": str(task_id)}
                for key, value in (old.markers or {}).items()
                if value.get("state") in ("started", "unknown")
            }
            session.add(
                Task(
                    id=new_id,
                    user_id=old.user_id,
                    conversation_id=old.conversation_id,
                    status="queued",
                    markers=carried,
                    last_event_seq=1,
                )
            )
            await session.flush()
            session.add(
                TaskEvent(task_id=new_id, seq=1, type="status", payload={"status": "queued"})
            )
            await session.execute(
                update(Message)
                .where(Message.task_id == task_id, Message.role == "user")
                .values(task_id=new_id)
            )
        await self.start(new_id)
        return new_id

    # ---- user input and cancellation -------------------------------------

    async def _wait_for_input(
        self, task_id: uuid.UUID, card_seq: int, expires_at: datetime
    ) -> tuple[uuid.UUID, dict[str, Any] | None]:
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._waiters[task_id] = _Waiter(card_seq, future)
        try:
            # The answer may already be stored (sent while this process was down).
            async with self.session_factory() as session:
                stored = (
                    await session.execute(
                        select(TaskInput.id, TaskInput.data)
                        .where(
                            TaskInput.task_id == task_id,
                            TaskInput.card_seq == card_seq,
                            TaskInput.consumed_at.is_(None),
                        )
                        .order_by(TaskInput.created_at)
                        .limit(1)
                    )
                ).first()
            if stored is not None:
                return stored.id, stored.data
            remaining = (expires_at - datetime.now(UTC)).total_seconds()
            if remaining <= 0:
                raise WaitingTimeout()
            try:
                return await asyncio.wait_for(future, timeout=remaining)
            except TimeoutError as exc:
                raise WaitingTimeout() from exc
        finally:
            if self._waiters.get(task_id) is not None and self._waiters[task_id].future is future:
                del self._waiters[task_id]

    def deliver_input(
        self, task_id: uuid.UUID, card_seq: int, input_id: uuid.UUID, data: dict[str, Any] | None
    ) -> bool:
        waiter = self._waiters.get(task_id)
        if waiter is None or waiter.card_seq != card_seq or waiter.future.done():
            return False
        waiter.future.set_result((input_id, data))
        return True

    async def revoke_site(self, user_id: uuid.UUID, site: str) -> list[uuid.UUID]:
        """Stop this user's running tasks that use `site`; they fail with access_revoked.

        Cancelling closes their browser (the browser agent kills it on the way out).
        """
        stopped = []
        for task_id, (owner, sites) in list(self._sites_in_use.items()):
            task = self._tasks.get(task_id)
            if owner == user_id and site in sites and task is not None:
                self._cancel_errors[task_id] = {
                    "code": "access_revoked",
                    "message": f"You revoked access to {site}, so I stopped.",
                    "retryable": False,
                }
                task.cancel()
                stopped.append(task_id)
        return stopped

    async def read_otp(self, input_id: uuid.UUID, user_id: uuid.UUID, site: str) -> str:
        if self.vault is None:
            raise RuntimeError("vault not configured")
        async with self.session_factory() as session:
            row = await session.get(TaskInput, input_id)
        if row is None or row.ciphertext is None:
            raise TaskFailed("internal_error", "The code was not found.", retryable=True)
        return self.vault.open(row, user_id=user_id, site=site, kind="otp")["code"]

    async def cancel(self, task_id: uuid.UUID) -> None:
        task = self._tasks.get(task_id)
        if task is not None:
            self._cancel_requested.add(task_id)
            task.cancel()
            return
        # Not running in this process: finish it directly.
        try:
            await self._finalize(task_id, worker_id=None, status="cancelled")
        except LostOwnership:
            pass  # already finished

    # ---- heartbeat -------------------------------------------------------

    async def _heartbeat_loop(self) -> None:
        while True:
            await asyncio.sleep(self.settings.heartbeat_interval)
            try:
                async with self.session_factory() as session, session.begin():
                    await session.execute(
                        update(Task)
                        .where(Task.worker_id == self.worker_id, Task.status.in_(ACTIVE_STATUSES))
                        .values(heartbeat_at=func.now())
                    )
            except Exception:
                log.exception("heartbeat failed")
