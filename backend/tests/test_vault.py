"""Phase 4.4: vault routes, OTP input, revoke, and checks that secrets never leak."""

import asyncio
import json
import uuid

import pyotp
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.crypto import Vault, load_master_key
from app.executors.orchestrator import Orchestrator
from app.vault import CredentialStore, clean_secret, make_label
from tests.conftest import (
    TEST_VAULT_KEY,
    make_settings,
    make_token,
    read_events,
    start_task,
    wait_for_status,
)
from tests.test_browser import make_user
from tests.test_orchestrator import ScriptedLLM, call, last_tool_result, say

PASSWORD = "hunter2-Sup3r-secret"
TOTP_SECRET = pyotp.random_base32()
OTP_CODE = "482913"


async def dump_everything(db) -> str:
    """Every text-ish column the app writes, joined: secrets must never appear in it."""
    queries = [
        "SELECT coalesce(string_agg(payload::text, ' '), '') FROM task_events",
        "SELECT coalesce(string_agg(content, ' '), '') FROM messages",
        "SELECT coalesce(string_agg(coalesce(data::text, ''), ' '), '') FROM task_inputs",
        "SELECT coalesce(string_agg(coalesce(checkpoint::text, '') || coalesce(result::text, '')"
        " || coalesce(error::text, ''), ' '), '') FROM tasks",
        "SELECT coalesce(string_agg(label, ' '), '') FROM credentials",
        "SELECT coalesce(string_agg(coalesce(metadata::text, ''), ' '), '') FROM audit_log",
        "SELECT coalesce(string_agg(encode(ciphertext, 'escape'), ' '), '') FROM credentials",
    ]
    async with db.connect() as conn:
        return " ".join([(await conn.execute(text(q))).scalar() for q in queries])


async def audit_actions(db) -> list[str]:
    async with db.connect() as conn:
        return (
            (await conn.execute(text("SELECT action FROM audit_log ORDER BY id"))).scalars().all()
        )


# ---- pure helpers -------------------------------------------------------------


def test_labels_never_reveal_the_secret():
    assert make_label("password", {"username": "adil@example.com"}, "github.com") == (
        "a…@example.com · github.com"
    )
    assert make_label("card", {"number": "4242424242424242"}, "swiggy.com") == "Card ••4242"
    label = make_label("api_key", {"key": "sk-or-v1-abcdef1234567890a91f"}, "openrouter.ai")
    assert label == "sk-or…a91f"


def test_totp_key_is_normalized():
    spaced = " ".join(TOTP_SECRET[i : i + 4] for i in range(0, len(TOTP_SECRET), 4)).lower()
    assert clean_secret("totp", {"secret": spaced}) == {"secret": TOTP_SECRET}


# ---- routes -------------------------------------------------------------------


async def test_store_list_replace_delete(client, db):
    body = {
        "site": "https://www.GitHub.com/login",
        "kind": "password",
        "secret": {"username": "adil@example.com", "password": PASSWORD},
    }
    resp = await client.post("/vault/credentials", json=body)
    assert resp.status_code == 201, resp.text
    assert resp.json()["site"] == "github.com"
    assert PASSWORD not in resp.text

    body["secret"]["password"] = PASSWORD + "-v2"
    again = await client.post("/vault/credentials", json=body)
    assert again.json()["id"] == resp.json()["id"]  # replaced, not duplicated

    listing = await client.get("/vault")
    site = listing.json()["sites"][0]
    assert site["site"] == "github.com" and len(site["credentials"]) == 1
    assert PASSWORD not in listing.text

    gone = await client.delete(f"/vault/credentials/{resp.json()['id']}")
    assert gone.status_code == 204
    assert (await client.get("/vault")).json() == {"sites": []}
    assert await audit_actions(db) == [
        "credential_added",
        "credential_updated",
        "credential_revoked",
    ]
    assert PASSWORD not in await dump_everything(db)


async def test_bad_secrets_are_rejected_without_echoing_them(client):
    cvv = await client.post(
        "/vault/credentials",
        json={
            "site": "swiggy.com",
            "kind": "card",
            "secret": {"number": "4242424242424242", "expiry": "12/29", "name": "A", "cvv": "987"},
        },
    )
    assert cvv.status_code == 422 and "987" not in cvv.text

    totp = await client.post(
        "/vault/credentials",
        json={"site": "github.com", "kind": "totp", "secret": {"secret": "not!base32@@"}},
    )
    assert totp.status_code == 422
    assert totp.json()["error"]["code"] == "invalid_totp_secret"
    assert "not!base32" not in totp.text

    shape = await client.post(
        "/vault/credentials",
        json={"site": "github.com", "kind": "nope", "secret": {"password": PASSWORD}},
    )
    assert shape.status_code == 422 and PASSWORD not in shape.text


async def test_other_users_cannot_touch_credentials(client):
    resp = await client.post(
        "/vault/credentials",
        json={"site": "openrouter.ai", "kind": "api_key", "secret": {"key": "sk-or-1234567890abc"}},
    )
    other = {"Authorization": f"Bearer {make_token(sub='someone-else', email='x@example.com')}"}
    assert (
        await client.delete(f"/vault/credentials/{resp.json()['id']}", headers=other)
    ).status_code == 404
    assert (await client.get("/vault", headers=other)).json() == {"sites": []}


async def test_revoke_site_deletes_everything(client, db):
    for kind, secret in (
        ("password", {"username": "a@b.co", "password": PASSWORD}),
        ("totp", {"secret": TOTP_SECRET}),
    ):
        await client.post(
            "/vault/credentials", json={"site": "github.com", "kind": kind, "secret": secret}
        )
    assert (await client.delete("/vault/sites/github.com")).status_code == 204
    assert (await client.get("/vault")).json() == {"sites": []}
    actions = await audit_actions(db)
    assert actions.count("credential_revoked") == 2

    audit = (await client.get("/vault/audit", params={"limit": 3})).json()
    assert len(audit["items"]) == 3 and audit["next_cursor"]
    rest = (await client.get("/vault/audit", params={"before": audit["next_cursor"]})).json()
    assert len(rest["items"]) == 1 and rest["next_cursor"] is None


# ---- browser placeholders -----------------------------------------------------


async def test_browser_secrets_are_keyed_by_placeholder(db):
    store = CredentialStore(
        async_sessionmaker(db, expire_on_commit=False), Vault(load_master_key(TEST_VAULT_KEY))
    )
    user = await make_user(db)
    await store.save(user, "github.com", "password", {"username": "a@b.co", "password": PASSWORD})
    await store.save(user, "github.com", "totp", {"secret": TOTP_SECRET})
    await store.save(user, "other.com", "api_key", {"key": "should-not-appear-1234"})

    secrets = await store.browser_secrets(user, "github.com")
    assert secrets == {
        "github.com_username": "a@b.co",
        "github.com_password": PASSWORD,
        "github.com_bu_2fa_code": TOTP_SECRET,
    }
    assert (await audit_actions(db)).count("credential_used") == 2


# ---- tasks: secure input, OTP, revoke -----------------------------------------


async def test_secure_input_card_saved_for_task_wakes_it(make_client, db):
    args = {"site": "github.com", "kind": "password", "reason": "To log in"}
    llm = ScriptedLLM(call("request_access", args), say("Connected."))
    client = await make_client(executor=Orchestrator(llm, None, make_settings()))
    _, task_id = await start_task(client, "log in to github")
    task = await wait_for_status(client, task_id, "waiting_user")

    resp = await client.post(
        "/vault/credentials",
        json={
            "site": "github.com",
            "kind": "password",
            "secret": {"username": "adil@example.com", "password": PASSWORD},
            "for_task": {"task_id": task_id, "card_seq": task["waiting_for"]["card_seq"]},
        },
    )
    assert resp.status_code == 201
    await wait_for_status(client, task_id, "done")
    result = json.loads(last_tool_result(llm)["content"])
    assert result["connected"] is True
    assert result["access"][0]["credentials"][0]["kind"] == "password"
    assert PASSWORD not in json.dumps(llm.calls)  # never reaches the model
    assert PASSWORD not in await dump_everything(db)


async def test_for_task_with_stale_card_stores_nothing(client):
    _, task_id = await start_task(client, "confirm please")  # fake executor: confirm card
    task = await wait_for_status(client, task_id, "waiting_user")
    resp = await client.post(
        "/vault/credentials",
        json={
            "site": "github.com",
            "kind": "api_key",
            "secret": {"key": "sk-1234567890abcdef"},
            "for_task": {"task_id": task_id, "card_seq": task["waiting_for"]["card_seq"]},
        },
    )
    assert resp.status_code == 422  # this card expects `confirm`
    assert (await client.get("/vault")).json() == {"sites": []}


class OtpExecutor:
    """Asks for an OTP and records what it got."""

    def __init__(self) -> None:
        self.code: str | None = None

    async def run(self, ctx) -> None:
        answer = await ctx.ask("otp", {"site": "swiggy.com", "title": "Enter the code"})
        self.code = answer["code"]
        await ctx.finish("Logged in.")


async def test_otp_is_encrypted_then_wiped(make_client, db):
    executor = OtpExecutor()
    client = await make_client(executor=executor)
    _, task_id = await start_task(client, "order food")
    task = await wait_for_status(client, task_id, "waiting_user")
    card_seq = task["waiting_for"]["card_seq"]

    bad = await client.post(
        f"/tasks/{task_id}/input", json={"card_seq": card_seq, "kind": "otp", "secret": "12ab"}
    )
    assert bad.status_code == 422 and "12ab" not in bad.text

    ok = await client.post(
        f"/tasks/{task_id}/input", json={"card_seq": card_seq, "kind": "otp", "secret": OTP_CODE}
    )
    assert ok.status_code == 202
    await wait_for_status(client, task_id, "done")
    assert executor.code == OTP_CODE

    async with db.connect() as conn:
        row = (
            await conn.execute(text("SELECT ciphertext, consumed_at, data FROM task_inputs"))
        ).one()
    assert row.ciphertext is None and row.consumed_at is not None and row.data == {}
    assert OTP_CODE not in await dump_everything(db)
    events = await read_events(client, task_id)
    assert OTP_CODE not in json.dumps(events)


class SiteExecutor:
    async def run(self, ctx) -> None:
        ctx.use_site("github.com")
        await ctx.ask("confirm", {"site": "github.com", "title": "Star it?"})
        await ctx.finish("Starred.")


async def test_revoke_stops_running_task(make_client):
    client = await make_client(executor=SiteExecutor())
    _, task_id = await start_task(client, "star repo")
    await wait_for_status(client, task_id, "waiting_user")
    await client.delete("/vault/sites/github.com")
    task = await wait_for_status(client, task_id, "failed")
    assert task["error"]["code"] == "access_revoked"
    assert task["error"]["retryable"] is False


async def test_revoke_other_site_leaves_task_alone(make_client):
    client = await make_client(executor=SiteExecutor())
    _, task_id = await start_task(client, "star repo")
    await wait_for_status(client, task_id, "waiting_user")
    await client.delete("/vault/sites/gitlab.com")
    await asyncio.sleep(0.2)
    assert (await client.get(f"/tasks/{task_id}")).json()["status"] == "waiting_user"


async def test_confirm_action_tool(make_client):
    llm = ScriptedLLM(
        call("confirm_action", {"site": "swiggy.com", "summary": "Order 1 roll, ₹249"}),
        say("Ordered."),
    )
    client = await make_client(executor=Orchestrator(llm, None, make_settings()))
    _, task_id = await start_task(client, "reorder")
    task = await wait_for_status(client, task_id, "waiting_user")
    assert task["waiting_for"]["kind"] == "confirm"
    await client.post(
        f"/tasks/{task_id}/input",
        json={
            "card_seq": task["waiting_for"]["card_seq"],
            "kind": "confirm",
            "data": {"decision": "reject"},
        },
    )
    await wait_for_status(client, task_id, "done")
    assert json.loads(last_tool_result(llm)["content"]) == {"decision": "reject"}


async def test_live_login_needs_a_browser(client):
    resp = await client.post("/vault/live-login", json={"site": "google.com"})
    assert resp.status_code == 503 and resp.json()["error"]["code"] == "browser_unavailable"
    missing = await client.post(f"/vault/live-login/{uuid.uuid4()}/complete")
    assert missing.status_code == 404


def test_cookie_site_match_rejects_lookalikes():
    from app.live_login import _same_site

    assert _same_site(".github.com", "github.com")
    assert _same_site("api.github.com", "github.com")
    assert not _same_site("evilgithub.com", "github.com")
