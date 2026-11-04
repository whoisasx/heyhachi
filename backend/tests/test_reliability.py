"""Phase 4.6: time limit, retry (resume / restart), idempotency markers."""

import asyncio
import json

from sqlalchemy import text

from app.executors.orchestrator import Orchestrator
from app.runner import TaskContext, TaskFailed
from tests.conftest import make_settings, read_events, start_task, wait_for_status
from tests.test_browser import RecordingBrowser
from tests.test_orchestrator import ScriptedLLM, call, say


async def answer(client, task_id: str, kind: str, data: dict) -> None:
    task = await wait_for_status(client, task_id, "waiting_user")
    resp = await client.post(
        f"/tasks/{task_id}/input",
        json={"card_seq": task["waiting_for"]["card_seq"], "kind": kind, "data": data},
    )
    assert resp.status_code == 202, resp.text


# ---- time limit --------------------------------------------------------------


class SlowExecutor:
    """Works for `work` seconds, optionally after waiting on a question card."""

    def __init__(self, work: float, ask_first: bool = False) -> None:
        self.work = work
        self.ask_first = ask_first

    async def run(self, ctx: TaskContext) -> None:
        if self.ask_first:
            await ctx.ask("question", {"title": "Which one?", "choices": []})
        await asyncio.sleep(self.work)
        await ctx.finish("Finished.")


async def test_working_too_long_hits_time_limit(make_client):
    client = await make_client(
        executor=SlowExecutor(work=30), max_task_seconds=0.3, watchdog_interval=0.05
    )
    _, task_id = await start_task(client, "slow")
    task = await wait_for_status(client, task_id, "failed")
    assert task["error"] == {
        "code": "time_limit",
        "message": "This task took too long, so I stopped it.",
        "retryable": True,
    }


async def test_waiting_for_the_user_does_not_count(make_client):
    client = await make_client(
        executor=SlowExecutor(work=0.1, ask_first=True),
        max_task_seconds=0.4,
        watchdog_interval=0.05,
    )
    _, task_id = await start_task(client, "slow")
    await wait_for_status(client, task_id, "waiting_user")
    await asyncio.sleep(0.6)  # longer than the limit, but only waiting
    await answer(client, task_id, "answer", {"text": "the first"})
    await wait_for_status(client, task_id, "done")


# ---- retry -----------------------------------------------------------------


async def test_resume_after_waiting_timeout_continues_the_same_task(make_client):
    llm = ScriptedLLM(
        call("ask_user", {"question": "Which repo?", "choices": []}), say("Starred it.")
    )
    client = await make_client(
        executor=Orchestrator(llm, None, make_settings()), waiting_timeout=0.3
    )
    _, task_id = await start_task(client, "star my repo")
    task = await wait_for_status(client, task_id, "failed")
    assert task["error"]["code"] == "waiting_timeout"

    resp = await client.post(f"/tasks/{task_id}/retry", json={"mode": "resume"})
    assert resp.status_code == 202, resp.text
    assert resp.json()["id"] == task_id

    # The pending question is asked again (fresh card), then the task finishes.
    await answer(client, task_id, "answer", {"text": "browser-use"})
    task = await wait_for_status(client, task_id, "done")
    assert task["attempt"] == 1
    assert len(llm.calls) == 2  # no LLM call repeated: resumed from the checkpoint
    events = await read_events(client, task_id)
    assert [e["data"]["kind"] for e in events if e["event"] == "card"] == [
        "question",
        "question",
    ]


async def test_restart_moves_the_message_to_a_new_task(client, db):
    conv_id, task_id = await start_task(client, "please fail")
    await wait_for_status(client, task_id, "failed")

    resp = await client.post(f"/tasks/{task_id}/retry", json={"mode": "restart"})
    assert resp.status_code == 202, resp.text
    new_id = resp.json()["id"]
    assert new_id != task_id
    await wait_for_status(client, new_id, "failed")  # same message, fails again

    detail = (await client.get(f"/conversations/{conv_id}")).json()
    assert [m["task_id"] for m in detail["messages"] if m["role"] == "user"] == [new_id]
    old = (await client.get(f"/tasks/{task_id}")).json()
    assert old["status"] == "failed"  # the old task is left as it was


async def test_retry_rules(make_client):
    client = await make_client(
        executor=SlowExecutor(work=30), max_task_seconds=0.2, watchdog_interval=0.05
    )
    _, task_id = await start_task(client, "slow")
    await wait_for_status(client, task_id, "running")

    running = await client.post(f"/tasks/{task_id}/retry", json={"mode": "resume"})
    assert running.status_code == 409
    assert running.json()["error"]["code"] == "task_not_retryable"

    await wait_for_status(client, task_id, "failed")  # time_limit
    resume = await client.post(f"/tasks/{task_id}/retry", json={"mode": "resume"})
    assert resume.status_code == 409
    assert resume.json()["error"]["code"] == "task_not_resumable"

    bad = await client.post(f"/tasks/{task_id}/retry", json={"mode": "again"})
    assert bad.status_code == 422


async def test_revoked_task_cannot_be_retried(client, db):
    _, task_id = await start_task(client, "please fail")
    await wait_for_status(client, task_id, "failed")
    async with db.begin() as conn:
        await conn.execute(
            text(
                "UPDATE tasks SET error = "
                """'{"code": "access_revoked", "message": "x", "retryable": false}'::jsonb """
                "WHERE id = :id"
            ),
            {"id": task_id},
        )
    resp = await client.post(f"/tasks/{task_id}/retry", json={"mode": "restart"})
    assert resp.status_code == 409


async def test_other_users_cannot_retry(client):
    _, task_id = await start_task(client, "please fail")
    await wait_for_status(client, task_id, "failed")
    from tests.conftest import make_token

    resp = await client.post(
        f"/tasks/{task_id}/retry",
        json={"mode": "restart"},
        headers={"Authorization": f"Bearer {make_token(sub='someone-else')}"},
    )
    assert resp.status_code == 404


# ---- idempotency markers ---------------------------------------------------------


class CrashingBrowser(RecordingBrowser):
    """Fails the first run as if the process died mid-action."""

    def __init__(self) -> None:
        super().__init__()
        self.crash_next = True

    async def run(self, ctx, *, site, instruction):
        self.runs.append((site, instruction))
        if self.crash_next:
            self.crash_next = False
            raise TaskFailed("internal_error", "Something went wrong.", retryable=True)
        return {"ok": True, "summary": "No order placed in the last hour."}


def order_script(*after: object) -> ScriptedLLM:
    return ScriptedLLM(
        call("confirm_action", {"site": "swiggy.com", "summary": "Order 1 roll, ₹249"}),
        call(
            "run_browser_task",
            {"site": "swiggy.com", "instruction": "Place the order"},
            tool_id="t2",
        ),
        *after,
    )


async def markers(db, task_id: str) -> dict:
    async with db.connect() as conn:
        return await conn.scalar(text("SELECT markers FROM tasks WHERE id = :id"), {"id": task_id})


async def test_approved_action_is_marked_started_then_done(make_client, db):
    browser = RecordingBrowser()
    llm = order_script(say("Ordered."))
    client = await make_client(executor=Orchestrator(llm, browser, make_settings()))
    _, task_id = await start_task(client, "reorder")
    await answer(client, task_id, "confirm", {"decision": "approve"})
    await wait_for_status(client, task_id, "done")
    assert await markers(db, task_id) == {
        "action_1": {
            "site": "swiggy.com",
            "summary": "Order 1 roll, ₹249",
            "state": "done",
            "ok": True,
        }
    }
    assert browser.runs == [("swiggy.com", "Place the order")]


async def test_interrupted_action_is_checked_not_repeated(make_client, db):
    browser = CrashingBrowser()
    llm = order_script(say("The order didn't go through. Want me to try again?"))
    client = await make_client(executor=Orchestrator(llm, browser, make_settings()))
    _, task_id = await start_task(client, "reorder")
    await answer(client, task_id, "confirm", {"decision": "approve"})
    await wait_for_status(client, task_id, "failed")
    assert (await markers(db, task_id))["action_1"]["state"] == "started"

    resp = await client.post(f"/tasks/{task_id}/retry", json={"mode": "resume"})
    assert resp.status_code == 202
    # Resuming re-runs the pending browser step; it finds the "started" marker
    # and only checks the site.
    await wait_for_status(client, task_id, "done")

    assert browser.runs[0] == ("swiggy.com", "Place the order")
    site, check = browser.runs[1]
    assert site == "swiggy.com" and check.startswith("Read-only check")
    assert "Order 1 roll" in check
    assert len(browser.runs) == 2  # the order was never placed a second time

    result = json.loads(llm.calls[-1][-1]["content"][0]["content"])
    assert "was NOT run" in result["note"]
    assert (await markers(db, task_id))["action_1"]["state"] == "unknown"


async def test_restart_carries_unfinished_markers(client, db):
    _, task_id = await start_task(client, "please fail")
    await wait_for_status(client, task_id, "failed")
    marker = {"site": "swiggy.com", "summary": "Order", "state": "started"}
    async with db.begin() as conn:
        await conn.execute(
            text("UPDATE tasks SET markers = CAST(:m AS jsonb) WHERE id = :id"),
            {
                "id": task_id,
                "m": json.dumps({"action_1": marker, "action_2": {**marker, "state": "done"}}),
            },
        )
    new_id = (await client.post(f"/tasks/{task_id}/retry", json={"mode": "restart"})).json()["id"]
    assert await markers(db, new_id) == {"action_1": {**marker, "carried_from": task_id}}
