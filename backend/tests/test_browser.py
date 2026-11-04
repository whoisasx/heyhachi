"""Phase 4.3: encryption, saved browser sessions, browser tool wiring. No real browser."""

import base64
import json
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from cryptography.exceptions import InvalidTag
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.browser_sessions import SessionStore, normalize_site
from app.crypto import Vault, VaultKeyError, load_master_key
from app.executors.browser import browser_cost_usd
from app.executors.orchestrator import Orchestrator
from tests.conftest import TEST_VAULT_KEY, make_settings, start_task, wait_for_status
from tests.test_orchestrator import ScriptedLLM, call, last_tool_result, say

VAULT = Vault(load_master_key(TEST_VAULT_KEY))
STATE = {"cookies": [{"name": "sid", "value": "abc", "domain": ".github.com"}], "origins": []}

# ---- crypto ----------------------------------------------------------------


def test_seal_and_open_round_trip():
    user = uuid.uuid4()
    sealed = VAULT.seal(STATE, user_id=user, site="github.com", kind="session")
    assert b"abc" not in sealed.ciphertext
    row = SimpleNamespace(**sealed.columns())
    assert VAULT.open(row, user_id=user, site="github.com", kind="session") == STATE


def test_ciphertext_is_bound_to_user_site_and_kind():
    user = uuid.uuid4()
    row = SimpleNamespace(**VAULT.seal(STATE, user_id=user, site="a.com", kind="session").columns())
    for other in (
        {"user_id": uuid.uuid4(), "site": "a.com", "kind": "session"},
        {"user_id": user, "site": "b.com", "kind": "session"},
        {"user_id": user, "site": "a.com", "kind": "password"},
    ):
        with pytest.raises(InvalidTag):
            VAULT.open(row, **other)


def test_master_key_must_be_32_bytes():
    with pytest.raises(VaultKeyError):
        load_master_key(base64.b64encode(b"short").decode())
    with pytest.raises(VaultKeyError):
        load_master_key(None)


def test_normalize_site():
    assert normalize_site("https://www.GitHub.com/login?x=1") == "github.com"
    assert normalize_site("swiggy.com") == "swiggy.com"
    assert normalize_site("http://localhost:3000/") == "localhost"


def test_browser_cost_counts_cache_reads_separately():
    usage = SimpleNamespace(
        total_prompt_tokens=1_000_000,  # includes the 600k cache reads
        total_prompt_cached_tokens=600_000,
        total_prompt_cache_creation_tokens=0,
        total_completion_tokens=100_000,
    )
    # 400k fresh * $2 + 600k cached * $0.20 + 100k out * $10 (per million)
    assert browser_cost_usd(usage, "claude-sonnet-5-5") == pytest.approx(0.8 + 0.12 + 1.0)
    assert browser_cost_usd(None, "claude-sonnet-5-5") == 0.0


# ---- saved sessions --------------------------------------------------------


async def make_user(db) -> uuid.UUID:
    user_id = uuid.uuid4()
    async with db.begin() as conn:
        await conn.execute(
            text("INSERT INTO users (id, google_sub, email) VALUES (:id, :sub, 'u@example.com')"),
            {"id": user_id, "sub": str(user_id)},
        )
    return user_id


async def test_session_save_load_expire(db):
    store = SessionStore(async_sessionmaker(db, expire_on_commit=False), VAULT)
    user = await make_user(db)

    assert await store.load(user, "github.com") is None
    await store.save(user, "github.com", STATE, source="live_login")
    assert await store.load(user, "github.com") == STATE

    newer = {**STATE, "cookies": [{"name": "sid", "value": "new", "domain": ".github.com"}]}
    await store.save(user, "github.com", newer, source="agent_login")
    assert await store.load(user, "github.com") == newer

    await store.mark_expired(user, "github.com")
    assert await store.load(user, "github.com") is None

    async with db.connect() as conn:
        rows = (await conn.execute(text("SELECT count(*), max(source) FROM sessions"))).one()
        actions = (
            (await conn.execute(text("SELECT action FROM audit_log ORDER BY id"))).scalars().all()
        )
        raw = (await conn.execute(text("SELECT ciphertext FROM sessions"))).scalar()
    assert rows == (1, "agent_login")  # one row per user+site, updated in place
    assert actions == ["session_saved", "session_used", "session_saved", "session_used"]
    assert b"new" not in raw


# ---- orchestrator wiring ---------------------------------------------------


class RecordingBrowser:
    def __init__(self) -> None:
        self.runs: list[tuple[str, str]] = []
        self.logins: list[str] = []
        self.saved = False

    async def run(self, ctx, *, site, instruction):
        self.runs.append((site, instruction))
        return {"ok": True, "summary": "Starred."}

    @asynccontextmanager
    async def live_login(self, ctx, site):
        self.logins.append(site)
        browser = self

        class Login:
            live_view_url = "https://live.example/view"

            async def save(self):
                browser.saved = True
                return True

        yield Login()


async def test_browser_login_opens_live_login_and_saves(make_client):
    browser = RecordingBrowser()
    llm = ScriptedLLM(
        call(
            "request_access",
            {
                "site": "https://www.github.com",
                "kind": "browser_login",
                "reason": "To star the repo",
            },
        ),
        call("run_browser_task", {"site": "github.com", "instruction": "Star x"}, tool_id="t2"),
        say("Starred x."),
    )
    client = await make_client(executor=Orchestrator(llm, browser, make_settings()))
    _, task_id = await start_task(client, "star x")
    task = await wait_for_status(client, task_id, "waiting_user")
    assert browser.logins == ["github.com"] and not browser.saved

    await client.post(
        f"/tasks/{task_id}/input",
        json={"card_seq": task["waiting_for"]["card_seq"], "kind": "credential_ready"},
    )
    await wait_for_status(client, task_id, "done")
    assert browser.saved
    assert browser.runs == [("github.com", "Star x")]
    assert json.loads(last_tool_result(llm)["content"]) == {"ok": True, "summary": "Starred."}
