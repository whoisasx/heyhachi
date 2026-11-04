"""Crash recovery: tasks left unfinished by a dead process (ARCHITECTURE §9.2)."""

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.db import make_session_factory
from app.events import EventStore, LostOwnership
from app.relay import Relay
from tests.conftest import read_events, wait_for_status


async def _orphan(
    db, *, status: str, attempt: int, checkpoint=None, waiting_for=None, content="hi"
):
    """Insert a user, conversation, message and a task owned by a dead worker."""
    user_id, conv_id, task_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    async with db.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO users (id, google_sub, email) "
                "VALUES (:id, 'google-user-1', 'adil@example.com')"
            ),
            {"id": user_id},
        )
        await conn.execute(
            text("INSERT INTO conversations (id, user_id) VALUES (:id, :u)"),
            {"id": conv_id, "u": user_id},
        )
        await conn.execute(
            text(
                "INSERT INTO tasks (id, user_id, conversation_id, status, attempt, worker_id, "
                "checkpoint, waiting_for, last_event_seq) VALUES (:id, :u, :c, :s, :a, "
                "'dead-worker', CAST(:cp AS jsonb), CAST(:wf AS jsonb), 3)"
            ),
            {
                "id": task_id,
                "u": user_id,
                "c": conv_id,
                "s": status,
                "a": attempt,
                "cp": json.dumps(checkpoint) if checkpoint else None,
                "wf": json.dumps(waiting_for) if waiting_for else None,
            },
        )
        for seq, etype, payload in (
            (1, "status", {"status": "queued"}),
            (2, "status", {"status": "running"}),
            (3, "progress", {"text": "Understanding your request"}),
        ):
            await conn.execute(
                text(
                    "INSERT INTO task_events (task_id, seq, type, payload) "
                    "VALUES (:t, :s, :ty, CAST(:p AS jsonb))"
                ),
                {"t": task_id, "s": seq, "ty": etype, "p": json.dumps(payload)},
            )
        await conn.execute(
            text(
                "INSERT INTO messages (id, conversation_id, role, content, task_id) "
                "VALUES (:id, :c, 'user', :content, :t)"
            ),
            {"id": uuid.uuid4(), "c": conv_id, "content": content, "t": task_id},
        )
    return user_id, task_id


async def test_running_task_resumes_from_checkpoint(db, make_client):
    _, task_id = await _orphan(db, status="running", attempt=1, checkpoint={"step": 1})
    client = await make_client()  # startup runs recovery
    task = await wait_for_status(client, str(task_id), "done")
    assert task["attempt"] == 2

    events = await read_events(client, str(task_id), headers={"Last-Event-ID": "3"})
    texts = [e["data"]["text"] for e in events if e["event"] == "progress"]
    assert texts[0] == "Hit a hiccup, picking up where I left off"
    assert "Understanding your request" not in texts  # step 0 was already done
    assert "Working on it" in texts


async def test_gives_up_after_max_attempts(db, make_client):
    _, task_id = await _orphan(db, status="running", attempt=3)
    client = await make_client()
    task = await wait_for_status(client, str(task_id), "failed")
    assert task["error"]["code"] == "too_many_attempts"
    assert task["error"]["retryable"] is True


async def test_waiting_task_uses_answer_sent_while_down(db, make_client):
    expires = (datetime.now(UTC) + timedelta(minutes=5)).isoformat()
    user_id, task_id = await _orphan(
        db,
        status="waiting_user",
        attempt=1,
        checkpoint={"step": 2},
        waiting_for={"kind": "confirm", "card_seq": 3, "expires_at": expires},
        content="confirm the order",
    )
    async with db.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO task_inputs (id, task_id, user_id, kind, card_seq, data) "
                "VALUES (:id, :t, :u, 'confirm', 3, '{\"decision\": \"approve\"}')"
            ),
            {"id": uuid.uuid4(), "t": task_id, "u": user_id},
        )
    client = await make_client()
    await wait_for_status(client, str(task_id), "done")
    events = await read_events(client, str(task_id), headers={"Last-Event-ID": "3"})
    assert not any(e["event"] == "card" for e in events)  # the old card was reused
    assert any(e["event"] == "card_resolved" and e["data"]["card_seq"] == 3 for e in events)


async def test_stale_worker_cannot_write(db):
    _, task_id = await _orphan(db, status="running", attempt=1)
    store = EventStore(make_session_factory(db), Relay())
    with pytest.raises(LostOwnership):
        await store.apply(
            task_id, worker_id="some-other-worker", events=[("progress", {"text": "x"})]
        )
    async with db.connect() as conn:
        count = (
            await conn.execute(
                text("SELECT count(*) FROM task_events WHERE task_id = :t"), {"t": task_id}
            )
        ).scalar()
    assert count == 3
