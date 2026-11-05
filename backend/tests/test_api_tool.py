"""The call_api tool: the backend adds the saved API key; the model never sees it."""

import json

import httpx

from app.executors.api import ApiCaller
from app.executors.orchestrator import Orchestrator
from tests.conftest import make_settings, start_task, wait_for_status
from tests.test_browser import RecordingBrowser
from tests.test_orchestrator import ScriptedLLM, call, say
from tests.test_vault import audit_actions

KEY = "sk-or-v1-" + "ab12" * 16


class FakeOpenRouter:
    """Records requests; echoes the key back to check it gets scrubbed."""

    def __init__(self, status: int = 200) -> None:
        self.requests: list[httpx.Request] = []
        self.status = status

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(
            self.status,
            json={
                "choices": [{"message": {"content": "Tabs bloom like spring leaves"}}],
                "echo": request.headers.get("authorization", ""),
            },
        )


def haiku_call(**overrides) -> dict:
    return {
        "site": "openrouter.ai",
        "method": "POST",
        "path": "/chat/completions",
        "body": json.dumps(
            {
                "model": "meta-llama/llama-3.3-8b-instruct:free",
                "messages": [{"role": "user", "content": "haiku"}],
            }
        ),
        **overrides,
    }


async def run(make_client, llm, fake) -> tuple[httpx.AsyncClient, str]:
    api = ApiCaller(make_settings(), transport=httpx.MockTransport(fake))
    client = await make_client(executor=Orchestrator(llm, RecordingBrowser(), make_settings(), api))
    return client, (await start_task(client, "write a haiku with openrouter"))[1]


async def save_key(client) -> None:
    resp = await client.post(
        "/vault/credentials",
        json={"site": "openrouter.ai", "kind": "api_key", "secret": {"key": KEY}},
    )
    assert resp.status_code == 201, resp.text


def last_tool_result(llm: ScriptedLLM) -> dict:
    return json.loads(llm.calls[-1][-1]["content"][0]["content"])


async def test_call_api_adds_the_key_and_hides_it(make_client, db):
    fake = FakeOpenRouter()
    llm = ScriptedLLM(call("call_api", haiku_call()), say("Here's your haiku."))
    api = ApiCaller(make_settings(), transport=httpx.MockTransport(fake))
    client = await make_client(executor=Orchestrator(llm, RecordingBrowser(), make_settings(), api))
    await save_key(client)
    _, task_id = await start_task(client, "write a haiku with openrouter")
    await wait_for_status(client, task_id, "done")

    [req] = fake.requests
    assert str(req.url) == "https://openrouter.ai/api/v1/chat/completions"
    assert req.headers["authorization"] == f"Bearer {KEY}"
    assert json.loads(req.content)["model"].endswith(":free")

    result = last_tool_result(llm)
    assert result["ok"] is True and result["status"] == 200
    assert "Tabs bloom" in result["body"]
    # The key never reaches the model, even when the API echoes it back.
    assert KEY not in json.dumps(llm.calls)
    assert "[redacted]" in result["body"]
    assert (await audit_actions(db))[-1] == "credential_used"


async def test_call_api_without_a_key_says_to_request_access(make_client):
    fake = FakeOpenRouter()
    llm = ScriptedLLM(call("call_api", haiku_call()), say("I need your key."))
    client, task_id = await run(make_client, llm, fake)
    await wait_for_status(client, task_id, "done")
    assert fake.requests == []
    result = last_tool_result(llm)
    assert result["error"] == "no_api_key" and "request_access" in result["message"]


async def test_call_api_only_reaches_allowlisted_bases(make_client):
    fake = FakeOpenRouter()
    llm = ScriptedLLM(
        call("call_api", haiku_call(site="evil.example")),
        call("call_api", haiku_call(path="//evil.example/steal"), tool_id="t2"),
        call("call_api", haiku_call(path="https://evil.example/x"), tool_id="t3"),
        say("Couldn't."),
    )
    api = ApiCaller(make_settings(), transport=httpx.MockTransport(fake))
    client = await make_client(executor=Orchestrator(llm, RecordingBrowser(), make_settings(), api))
    await save_key(client)  # a key exists, so only the URL checks stop these
    _, task_id = await start_task(client, "write a haiku with openrouter")
    await wait_for_status(client, task_id, "done")
    assert fake.requests == []
    errors = [json.loads(c[-1]["content"][0]["content"])["error"] for c in llm.calls[1:]]
    assert errors == ["no_api_support", "bad_request", "bad_request"]


async def test_bad_json_body_is_a_tool_error(make_client):
    fake = FakeOpenRouter()
    llm = ScriptedLLM(call("call_api", haiku_call(body="{not json")), say("Oops."))
    client, task_id = await run(make_client, llm, fake)
    await wait_for_status(client, task_id, "done")
    block = llm.calls[-1][-1]["content"][0]
    assert block["is_error"] is True and "JSON" in block["content"]
    assert fake.requests == []
