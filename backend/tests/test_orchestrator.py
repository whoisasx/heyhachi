"""Orchestrator tests with a scripted fake LLM (phase 4.2). No network, no API spend."""

import json
import uuid
from typing import Any

import pytest
from sqlalchemy import text

from app.executors.browser import UnavailableBrowser
from app.executors.orchestrator import Orchestrator
from app.llm import LLMResponse, Usage
from tests.conftest import make_settings, read_events, start_task, wait_for_status


class ScriptedLLM:
    """Returns pre-written responses in order and records what it was sent."""

    model = "claude-sonnet-5-5"

    def __init__(self, *responses: LLMResponse) -> None:
        self.responses = list(responses)
        self.calls: list[list[dict[str, Any]]] = []

    async def create(self, *, system, messages, tools) -> LLMResponse:
        self.calls.append(json.loads(json.dumps(messages)))  # snapshot
        return self.responses.pop(0)


def say(text_: str) -> LLMResponse:
    return LLMResponse(
        content=[{"type": "text", "text": text_}],
        stop_reason="end_turn",
        usage=Usage(input_tokens=1000, output_tokens=100),
        model="claude-sonnet-5-5",
    )


def call(tool: str, args: dict, *, note: str = "", tool_id: str = "toolu_1") -> LLMResponse:
    content: list[dict] = []
    if note:
        content.append({"type": "text", "text": note})
    content.append({"type": "tool_use", "id": tool_id, "name": tool, "input": args})
    return LLMResponse(
        content=content,
        stop_reason="tool_use",
        usage=Usage(input_tokens=1000, output_tokens=100),
        model="claude-sonnet-5-5",
    )


def orchestrator(llm: ScriptedLLM, **settings: Any) -> Orchestrator:
    return Orchestrator(llm, UnavailableBrowser(), make_settings(**settings))


def last_tool_result(llm: ScriptedLLM) -> dict:
    return llm.calls[-1][-1]["content"][0]


async def test_plain_reply_finishes_task_and_tracks_cost(make_client, db):
    llm = ScriptedLLM(say("Hi! What should I do?"))
    client = await make_client(executor=orchestrator(llm))
    conv_id, task_id = await start_task(client, "hello")
    await wait_for_status(client, task_id, "done")

    assert llm.calls[0] == [{"role": "user", "content": "hello"}]
    conv = (await client.get(f"/conversations/{conv_id}")).json()
    assert conv["messages"][-1]["content"] == "Hi! What should I do?"
    async with db.connect() as conn:
        cost = (await conn.execute(text("SELECT cost_usd FROM tasks"))).scalar()
    assert float(cost) > 0  # 1000 in + 100 out at Sonnet prices = $0.003


async def test_ask_user_card_then_final_reply(make_client):
    llm = ScriptedLLM(
        call("ask_user", {"question": "Which repo?", "choices": ["a", "b"]}, note="Let me check."),
        say("Starred repo b."),
    )
    client = await make_client(executor=orchestrator(llm))
    _, task_id = await start_task(client, "star my repo")
    task = await wait_for_status(client, task_id, "waiting_user")
    assert task["waiting_for"]["kind"] == "question"

    resp = await client.post(
        f"/tasks/{task_id}/input",
        json={"card_seq": task["waiting_for"]["card_seq"], "kind": "answer", "data": {"text": "b"}},
    )
    assert resp.status_code == 202
    await wait_for_status(client, task_id, "done")

    result = last_tool_result(llm)
    assert result["tool_use_id"] == "toolu_1"
    assert json.loads(result["content"]) == {"answer": "b"}
    events = await read_events(client, task_id)
    cards = [e["data"] for e in events if e["event"] == "card"]
    assert cards[0]["title"] == "Which repo?" and cards[0]["choices"] == ["a", "b"]
    progress = [e["data"]["text"] for e in events if e["event"] == "progress"]
    assert "Let me check." in progress


async def test_browser_stub_is_honest(make_client):
    llm = ScriptedLLM(
        call("run_browser_task", {"site": "GitHub.com", "instruction": "star repo x"}),
        say("I couldn't do that yet: the browser isn't connected."),
    )
    client = await make_client(executor=orchestrator(llm))
    _, task_id = await start_task(client, "star repo x")
    await wait_for_status(client, task_id, "done")

    result = json.loads(last_tool_result(llm)["content"])
    assert result["ok"] is False and result["error"] == "browser_unavailable"


async def test_request_access_shows_secure_card(make_client):
    args = {"site": "openrouter.ai", "kind": "api_key", "reason": "To call it"}
    llm = ScriptedLLM(call("request_access", args), say("Thanks."))
    client = await make_client(executor=orchestrator(llm))
    _, task_id = await start_task(client, "use my openrouter key")
    task = await wait_for_status(client, task_id, "waiting_user")
    assert task["waiting_for"]["kind"] == "credential"
    assert task["waiting_for"]["site"] == "openrouter.ai"

    await client.post(
        f"/tasks/{task_id}/input",
        json={"card_seq": task["waiting_for"]["card_seq"], "kind": "credential_ready"},
    )
    await wait_for_status(client, task_id, "done")
    result = json.loads(last_tool_result(llm)["content"])
    assert result == {"site": "openrouter.ai", "connected": False, "access": []}

    # The stream ends when the task does, so read events after it finished.
    events = await read_events(client, task_id)
    card = [e["data"] for e in events if e["event"] == "card"][0]
    assert card["kind"] == "secure_input"  # overrides the generic "credential"
    assert card["access"] == "api_key" and card["fields"][0]["type"] == "password"


async def test_unknown_tool_is_reported_back_as_error(make_client):
    llm = ScriptedLLM(call("delete_everything", {}), say("Sorry."))
    client = await make_client(executor=orchestrator(llm))
    _, task_id = await start_task(client, "hi")
    await wait_for_status(client, task_id, "done")
    assert last_tool_result(llm)["is_error"] is True


async def test_refusal_fails_without_retry(make_client):
    refusal = LLMResponse(content=[], stop_reason="refusal", model="claude-sonnet-5-5")
    client = await make_client(executor=orchestrator(ScriptedLLM(refusal)))
    _, task_id = await start_task(client, "something bad")
    task = await wait_for_status(client, task_id, "failed")
    assert task["error"]["code"] == "refused"
    assert task["error"]["retryable"] is False


async def test_step_limit(make_client):
    llm = ScriptedLLM(*[call("list_connected_accounts", {}, tool_id=f"t{i}") for i in range(5)])
    client = await make_client(executor=orchestrator(llm, orchestrator_max_steps=3))
    _, task_id = await start_task(client, "loop forever")
    task = await wait_for_status(client, task_id, "failed")
    assert task["error"]["code"] == "step_limit"
    assert len(llm.calls) == 3


async def test_cost_limit(make_client):
    big = Usage(input_tokens=1_000_000)  # $2 at Sonnet prices
    resp = LLMResponse(content=[{"type": "text", "text": "x"}], stop_reason="end_turn", usage=big)
    client = await make_client(executor=orchestrator(ScriptedLLM(resp)))
    _, task_id = await start_task(client, "expensive")
    task = await wait_for_status(client, task_id, "failed")
    assert task["error"]["code"] == "cost_limit"


async def test_daily_limit_stops_task_and_blocks_new_ones(make_client):
    big = Usage(input_tokens=1_000_000)  # $2 at Sonnet prices
    resp = LLMResponse(content=[{"type": "text", "text": "x"}], stop_reason="end_turn", usage=big)
    client = await make_client(
        executor=orchestrator(ScriptedLLM(resp)),
        max_cost_per_task_usd=10.0,
        max_cost_per_user_day_usd=1.0,
    )
    _, task_id = await start_task(client, "expensive")
    task = await wait_for_status(client, task_id, "failed")
    assert task["error"]["code"] == "daily_limit"

    conv = (await client.post("/conversations")).json()
    blocked = await client.post(
        f"/conversations/{conv['id']}/messages",
        json={"content": "one more", "client_message_id": str(uuid.uuid4())},
    )
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "daily_limit"

    retry = await client.post(f"/tasks/{task_id}/retry", json={"mode": "resume"})
    assert retry.status_code == 429
    assert retry.json()["error"]["code"] == "daily_limit"


class FakeCtx:
    """Minimal TaskContext stand-in for resume logic."""

    def __init__(self, checkpoint: dict) -> None:
        self.checkpoint = checkpoint
        self.request_text = "star repo x"
        self.saved: list[dict] = []
        self.reply: str | None = None

    async def save_checkpoint(self, cp):
        self.saved.append(json.loads(json.dumps(cp)))

    async def add_cost(self, usd):
        return usd

    async def progress(self, text_):
        pass

    async def connected_accounts(self):
        return [{"site": "github.com", "credentials": [], "session": "active"}]

    async def finish(self, reply, result=None):
        self.reply = reply


async def test_resume_reruns_pending_tool_calls_then_continues():
    # Crashed after Claude asked for a tool but before its result was saved.
    checkpoint = {
        "version": 1,
        "orchestrator_steps": 1,
        "messages": [
            {"role": "user", "content": "star repo x"},
            {
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "id": "t1", "name": "list_connected_accounts", "input": {}}
                ],
            },
        ],
    }
    llm = ScriptedLLM(say("You have GitHub connected."))
    ctx = FakeCtx(checkpoint)
    await orchestrator(llm).run(ctx)

    sent = llm.calls[0]
    assert len(sent) == 3 and sent[2]["content"][0]["tool_use_id"] == "t1"
    assert "github.com" in sent[2]["content"][0]["content"]
    assert ctx.reply == "You have GitHub connected."
    assert ctx.saved[-1]["orchestrator_steps"] == 2


async def test_follow_up_sees_what_earlier_replies_were_based_on(make_client):
    """Earlier replies come with a note of the tools behind them (no false 'corrections')."""
    import uuid as _uuid

    from tests.test_browser import RecordingBrowser

    llm = ScriptedLLM(
        call("ask_user", {"question": "Which repo?", "choices": ["a/a", "b/b"]}),
        call(
            "run_browser_task",
            {"site": "github.com", "instruction": "Read the star count of b/b"},
            tool_id="t2",
        ),
        say("b/b has about 99k stars."),
        say("Sure."),
    )
    client = await make_client(executor=Orchestrator(llm, RecordingBrowser(), make_settings()))
    conv_id, task_id = await start_task(client, "stars of a/a or b/b? ask me first")
    task = await wait_for_status(client, task_id, "waiting_user")
    await client.post(
        f"/tasks/{task_id}/input",
        json={
            "card_seq": task["waiting_for"]["card_seq"],
            "kind": "answer",
            "data": {"text": "b/b"},
        },
    )
    await wait_for_status(client, task_id, "done")

    resp = await client.post(
        f"/conversations/{conv_id}/messages",
        json={"content": "thanks, now list its issues", "client_message_id": str(_uuid.uuid4())},
    )
    await wait_for_status(client, resp.json()["task"]["id"], "done")

    first_call_of_follow_up = llm.calls[-1]
    earlier_reply = first_call_of_follow_up[-2]
    assert earlier_reply["role"] == "assistant"
    assert earlier_reply["content"].endswith("b/b has about 99k stars.")
    assert '- asked "Which repo?"; user answered "b/b"' in earlier_reply["content"]
    assert (
        "- browsed github.com: Read the star count of b/b (succeeded)" in earlier_reply["content"]
    )


@pytest.mark.parametrize(
    ("api_message", "shown"),
    [
        ("You have reached your specified API usage limits.", "usage limit"),
        ("Your credit balance is too low to access the Anthropic API.", "out of credit"),
    ],
)
async def test_ai_usage_limit_is_a_clear_error(make_client, api_message, shown):
    import anthropic
    import httpx

    class LimitedLLM(ScriptedLLM):
        async def create(self, *, system, messages, tools):
            request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
            raise anthropic.BadRequestError(
                api_message,
                response=httpx.Response(400, request=request),
                body=None,
            )

    client = await make_client(executor=Orchestrator(LimitedLLM(), None, make_settings()))
    _, task_id = await start_task(client, "anything")
    task = await wait_for_status(client, task_id, "failed")
    assert task["error"]["code"] == "upstream_limit"
    assert shown in task["error"]["message"]
