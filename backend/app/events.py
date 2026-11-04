"""Task state changes + events, written together (docs/ARCHITECTURE.md §9.1).

Rules:
1. One transaction updates `tasks` and inserts the `task_events` rows.
2. Events are pushed to the relay only after the commit.
3. When a worker_id is given, the update only applies if that worker still owns the task.
"""

import uuid
from collections.abc import Awaitable, Callable, Sequence
from typing import Any

from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Task, TaskEvent
from app.relay import Event, Relay

EventSpec = tuple[str, dict[str, Any]]


class LostOwnership(Exception):
    """This runner no longer owns the task (it was taken over or finished elsewhere)."""


class EventStore:
    def __init__(self, session_factory: async_sessionmaker, relay: Relay) -> None:
        self.session_factory = session_factory
        self.relay = relay

    async def apply(
        self,
        task_id: uuid.UUID,
        *,
        worker_id: str | None,
        events: Sequence[EventSpec] = (),
        changes: dict[str, Any] | None = None,
        changes_from_seqs: Callable[[list[int]], dict[str, Any]] | None = None,
        extra: Callable[[AsyncSession], Awaitable[None]] | None = None,
        only_if_status_in: Sequence[str] | None = None,
    ) -> list[Event]:
        """Atomically: allocate event seqs, apply task changes, insert events, run `extra`.

        `changes_from_seqs` lets a change depend on the new events' seqs
        (e.g. `waiting_for.card_seq` must equal the card event's seq).
        Raises LostOwnership if the ownership/status guard doesn't match.
        """
        async with self.session_factory() as session, session.begin():
            claim = (
                update(Task)
                .where(Task.id == task_id)
                .values(last_event_seq=Task.last_event_seq + len(events), updated_at=func.now())
                .returning(Task.last_event_seq)
            )
            if worker_id is not None:
                claim = claim.where(Task.worker_id == worker_id)
            if only_if_status_in is not None:
                claim = claim.where(Task.status.in_(only_if_status_in))
            last_seq = await session.scalar(claim)
            if last_seq is None:
                raise LostOwnership(str(task_id))

            seqs = list(range(last_seq - len(events) + 1, last_seq + 1))
            values = dict(changes or {})
            if changes_from_seqs is not None:
                values.update(changes_from_seqs(seqs))
            if values:
                await session.execute(update(Task).where(Task.id == task_id).values(**values))
            if events:
                await session.execute(
                    insert(TaskEvent),
                    [
                        {"task_id": task_id, "seq": seq, "type": etype, "payload": payload}
                        for seq, (etype, payload) in zip(seqs, events, strict=True)
                    ],
                )
            if extra is not None:
                await extra(session)

        published = [
            Event(seq=seq, type=etype, payload=payload)
            for seq, (etype, payload) in zip(seqs, events, strict=True)
        ]
        for event in published:
            self.relay.publish(task_id, event)
        return published

    async def events_after(self, task_id: uuid.UUID, after: int) -> list[Event]:
        async with self.session_factory() as session:
            rows = await session.execute(
                select(TaskEvent.seq, TaskEvent.type, TaskEvent.payload)
                .where(TaskEvent.task_id == task_id, TaskEvent.seq > after)
                .order_by(TaskEvent.seq)
            )
            return [Event(seq=r.seq, type=r.type, payload=r.payload) for r in rows]
