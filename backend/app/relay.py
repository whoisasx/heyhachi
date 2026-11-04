"""In-memory relay: task_id -> open SSE subscribers (docs/ARCHITECTURE.md §4.4).

Only valid while the backend is a single process. Events are always written to
Postgres first, so a subscriber that misses something catches up on reconnect.
"""

import asyncio
import uuid
from collections import defaultdict
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

QUEUE_SIZE = 1000


@dataclass(frozen=True)
class Event:
    seq: int
    type: str
    payload: dict[str, Any]


class Relay:
    def __init__(self) -> None:
        self._subscribers: dict[uuid.UUID, set[asyncio.Queue[Event]]] = defaultdict(set)

    @contextmanager
    def subscribe(self, task_id: uuid.UUID) -> Iterator[asyncio.Queue[Event]]:
        queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=QUEUE_SIZE)
        self._subscribers[task_id].add(queue)
        try:
            yield queue
        finally:
            subscribers = self._subscribers.get(task_id)
            if subscribers is not None:
                subscribers.discard(queue)
                if not subscribers:
                    del self._subscribers[task_id]

    def publish(self, task_id: uuid.UUID, event: Event) -> None:
        for queue in list(self._subscribers.get(task_id, ())):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # Slow client: drop events; it replays from Postgres on reconnect.
                pass

    def subscriber_count(self, task_id: uuid.UUID) -> int:
        return len(self._subscribers.get(task_id, ()))
