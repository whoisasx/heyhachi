"""End-to-end API tests with the fake executor (phase 4.1)."""

import uuid

from sqlalchemy import text

from app.executors.fake import FakeExecutor
from tests.conftest import make_token, read_events, start_task, wait_for_status


def statuses(events: list[dict]) -> list[str]:
    return [e["data"]["status"] for e in events if e["event"] == "status"]


# ---- auth ------------------------------------------------------------------


async def test_health_needs_no_auth(client):
    resp = await client.get("/health", headers={"Authorization": ""})
    assert resp.json() == {"status": "ok"}


async def test_me_requires_token(client):
    resp = await client.get("/me", headers={"Authorization": ""})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "unauthenticated"


async def test_me_upserts_user(client, db):
    resp = await client.get("/me")
    assert resp.status_code == 200
    assert resp.json()["email"] == "adil@example.com"
    await client.get("/me")
    async with db.connect() as conn:
        assert (await conn.execute(text("SELECT count(*) FROM users"))).scalar() == 1


async def test_expired_token(client):
    token = make_token(exp=1, iat=0)
    resp = await client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "token_expired"


# ---- happy path and events -------------------------------------------------


async def test_task_runs_to_done_and_records_events(client):
    conv_id, task_id = await start_task(client, "Draft a mail to Rahul")
    task = await wait_for_status(client, task_id, "done")
    assert task["result"] == {"fake": True}
    assert task["attempt"] == 1

    events = await read_events(client, task_id)
    assert [e["id"] for e in events] == list(range(1, len(events) + 1))
    assert statuses(events) == ["queued", "running", "verifying", "done"]
    assert [e["data"]["text"] for e in events if e["event"] == "progress"] == [
        "Understanding your request",
        "Working on it",
        "Checking the result",
    ]
    reply = next(e for e in events if e["event"] == "reply")
    assert reply["data"]["text"] == "Done (fake task): Draft a mail to Rahul"

    conv = (await client.get(f"/conversations/{conv_id}")).json()
    assert [m["role"] for m in conv["messages"]] == ["user", "assistant"]
    assert conv["title"] == "Draft a mail to Rahul"


async def test_sse_replays_only_missed_events(client):
    _, task_id = await start_task(client, "hello")
    await wait_for_status(client, task_id, "done")
    all_events = await read_events(client, task_id)

    after_header = await read_events(client, task_id, headers={"Last-Event-ID": "3"})
    assert [e["id"] for e in after_header] == [e["id"] for e in all_events if e["id"] > 3]

    after_query = await read_events(client, task_id, params={"after": 5})
    assert [e["id"] for e in after_query] == [e["id"] for e in all_events if e["id"] > 5]

    nothing_left = await read_events(
        client, task_id, headers={"Last-Event-ID": str(all_events[-1]["id"])}
    )
    assert nothing_left == []


async def test_sse_live_stream_has_no_gaps_or_duplicates(make_client):
    client = await make_client(executor=FakeExecutor(step_delay=0.05))
    _, task_id = await start_task(client, "slow task")
    events = await read_events(client, task_id)  # connects while the task is running
    assert [e["id"] for e in events] == list(range(1, len(events) + 1))
    assert statuses(events)[-1] == "done"


async def test_failure_marks_task_failed(client):
    _, task_id = await start_task(client, "please fail")
    task = await wait_for_status(client, task_id, "failed")
    assert task["error"]["code"] == "internal_error"
    events = await read_events(client, task_id)
    assert any(e["event"] == "error" for e in events)
    assert statuses(events)[-1] == "failed"


# ---- waiting for the user ---------------------------------------------------


async def test_confirm_card_flow(client):
    _, task_id = await start_task(client, "confirm the order")
    task = await wait_for_status(client, task_id, "waiting_user")
    card_seq = task["waiting_for"]["card_seq"]
    assert task["waiting_for"]["kind"] == "confirm"

    stale = await client.post(
        f"/tasks/{task_id}/input",
        json={"card_seq": card_seq - 1, "kind": "confirm", "data": {"decision": "approve"}},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "stale_card"

    wrong_kind = await client.post(
        f"/tasks/{task_id}/input",
        json={"card_seq": card_seq, "kind": "answer", "data": {"text": "x"}},
    )
    assert wrong_kind.status_code == 422

    ok = await client.post(
        f"/tasks/{task_id}/input",
        json={"card_seq": card_seq, "kind": "confirm", "data": {"decision": "approve"}},
    )
    assert ok.status_code == 202
    await wait_for_status(client, task_id, "done")

    events = await read_events(client, task_id)
    card = next(e for e in events if e["event"] == "card")
    assert card["id"] == card_seq
    resolved = next(e for e in events if e["event"] == "card_resolved")
    assert resolved["data"] == {"card_seq": card_seq, "outcome": "submitted"}
    assert statuses(events) == ["queued", "running", "waiting_user", "running", "verifying", "done"]


async def test_reject_finishes_without_doing_it(client):
    _, task_id = await start_task(client, "confirm the order")
    task = await wait_for_status(client, task_id, "waiting_user")
    await client.post(
        f"/tasks/{task_id}/input",
        json={
            "card_seq": task["waiting_for"]["card_seq"],
            "kind": "confirm",
            "data": {"decision": "reject"},
        },
    )
    task = await wait_for_status(client, task_id, "done")
    assert task["result"] == {"approved": False}


async def test_waiting_timeout(make_client):
    client = await make_client(waiting_timeout=0.3)
    _, task_id = await start_task(client, "confirm the order")
    task = await wait_for_status(client, task_id, "waiting_user")
    card_seq = task["waiting_for"]["card_seq"]
    task = await wait_for_status(client, task_id, "failed")
    assert task["error"]["code"] == "waiting_timeout"

    late = await client.post(
        f"/tasks/{task_id}/input",
        json={"card_seq": card_seq, "kind": "confirm", "data": {"decision": "approve"}},
    )
    assert late.status_code == 410
    events = await read_events(client, task_id)
    resolved = next(e for e in events if e["event"] == "card_resolved")
    assert resolved["data"]["outcome"] == "expired"


async def test_cancel_waiting_task(client):
    _, task_id = await start_task(client, "confirm the order")
    await wait_for_status(client, task_id, "waiting_user")
    resp = await client.post(f"/tasks/{task_id}/cancel")
    assert resp.status_code == 202
    await wait_for_status(client, task_id, "cancelled")

    events = await read_events(client, task_id)
    assert (
        next(e for e in events if e["event"] == "card_resolved")["data"]["outcome"] == "cancelled"
    )
    again = await client.post(f"/tasks/{task_id}/cancel")
    assert again.status_code == 409


# ---- message rules ---------------------------------------------------------


async def test_secret_in_message_is_rejected_and_not_stored(client, db):
    conv = (await client.post("/conversations")).json()
    resp = await client.post(
        f"/conversations/{conv['id']}/messages",
        json={
            "content": "use my key sk-or-v1-0123456789abcdef0123456789",
            "client_message_id": str(uuid.uuid4()),
        },
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "secret_in_message"
    assert "sk-or" not in resp.text

    async with db.connect() as conn:
        assert (await conn.execute(text("SELECT count(*) FROM messages"))).scalar() == 0
        action = (await conn.execute(text("SELECT action, metadata FROM audit_log"))).one()
    assert action.action == "secret_pasted_in_chat"
    assert "sk-or" not in str(action.metadata)


async def test_resending_same_message_is_idempotent(client, db):
    conv = (await client.post("/conversations")).json()
    body = {"content": "hello", "client_message_id": str(uuid.uuid4())}
    first = await client.post(f"/conversations/{conv['id']}/messages", json=body)
    second = await client.post(f"/conversations/{conv['id']}/messages", json=body)
    assert first.status_code == second.status_code == 202
    assert first.json()["task"]["id"] == second.json()["task"]["id"]
    async with db.connect() as conn:
        assert (await conn.execute(text("SELECT count(*) FROM tasks"))).scalar() == 1


async def test_one_active_task_per_conversation(client):
    conv_id, task_id = await start_task(client, "confirm the order")
    await wait_for_status(client, task_id, "waiting_user")
    resp = await client.post(
        f"/conversations/{conv_id}/messages",
        json={"content": "another", "client_message_id": str(uuid.uuid4())},
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "task_in_progress"


async def test_too_many_tasks_names_the_running_ones(client):
    running = []
    for i in range(3):  # max_active_tasks_per_user
        conv_id, task_id = await start_task(client, f"confirm order {i}")
        await wait_for_status(client, task_id, "waiting_user")
        running.append((conv_id, task_id))
    conv = (await client.post("/conversations")).json()
    resp = await client.post(
        f"/conversations/{conv['id']}/messages",
        json={"content": "one more", "client_message_id": str(uuid.uuid4())},
    )
    assert resp.status_code == 429
    error = resp.json()["error"]
    assert error["code"] == "too_many_active_tasks"
    assert [(r["conversation_id"], r["task_id"]) for r in error["details"]["running"]] == running
    assert error["details"]["running"][0]["title"] == "confirm order 0"


async def test_other_users_get_404(client):
    conv_id, task_id = await start_task(client, "hello")
    other = {"Authorization": f"Bearer {make_token(sub='google-user-2', email='x@example.com')}"}
    assert (await client.get(f"/tasks/{task_id}", headers=other)).status_code == 404
    assert (await client.get(f"/tasks/{task_id}/events", headers=other)).status_code == 404
    assert (await client.get(f"/conversations/{conv_id}", headers=other)).status_code == 404
    assert (await client.post(f"/tasks/{task_id}/cancel", headers=other)).status_code == 404


async def test_rename_conversation(client):
    conv_id, _ = await start_task(client, "hello")
    resp = await client.patch(f"/conversations/{conv_id}", json={"title": "  Swiggy   orders "})
    assert resp.status_code == 200
    assert resp.json()["title"] == "Swiggy orders"
    assert (await client.get(f"/conversations/{conv_id}")).json()["title"] == "Swiggy orders"

    blank = await client.patch(f"/conversations/{conv_id}", json={"title": "   "})
    assert blank.status_code == 422
    other = {"Authorization": f"Bearer {make_token(sub='google-user-2', email='x@example.com')}"}
    resp = await client.patch(f"/conversations/{conv_id}", json={"title": "mine"}, headers=other)
    assert resp.status_code == 404


# ---- settings + usage --------------------------------------------------------


async def test_settings_lists_models_and_limits(client):
    body = (await client.get("/settings")).json()
    assert body["models"]["orchestrator"]["provider"] == "Anthropic"
    assert body["limits"]["cost_per_task_usd"] > 0


async def test_usage_counts_own_tasks(make_client, db):
    client = await make_client(executor=FakeExecutor(step_delay=0))
    _, task_id = await start_task(client, "hello")
    await wait_for_status(client, task_id, "done")
    async with db.begin() as conn:
        await conn.execute(text("UPDATE tasks SET cost_usd = 0.25"))

    body = (await client.get("/usage?days=7")).json()
    assert (body["tasks"], body["done"], body["failed"]) == (1, 1, 0)
    assert body["cost_usd"] == 0.25
    assert body["daily"][0]["tasks"] == 1

    other = make_token(sub="someone-else", email="other@example.com")
    resp = await client.get("/usage", headers={"Authorization": f"Bearer {other}"})
    assert resp.json()["tasks"] == 0
