"""Saved logins keep only their own site's cookies, and 'Sign in with Google' needs approval."""

import uuid

from sqlalchemy.ext.asyncio import async_sessionmaker

from app.browser_sessions import SessionStore, only_site
from app.executors.browser import GOOGLE_RULE, as_cdp_cookies, load_google_login
from tests.test_browser import VAULT, make_user

MIXED = {
    "cookies": [
        {"name": "sid", "value": "fb", "domain": ".facebook.com", "path": "/", "expires": -1},
        {"name": "c", "value": "m", "domain": "m.facebook.com", "path": "/"},
        {"name": "SID", "value": "g", "domain": ".google.com", "path": "/", "expires": 1.9e9},
        {"name": "ad", "value": "t", "domain": ".doubleclick.net", "path": "/"},
        {"name": "x", "value": "evil", "domain": "evilfacebook.com", "path": "/"},
    ],
    "origins": [
        {"origin": "https://www.facebook.com", "localStorage": [{"name": "a", "value": "1"}]},
        {"origin": "https://accounts.google.com", "localStorage": [{"name": "b", "value": "2"}]},
    ],
}


def names(state) -> set[str]:
    return {c["value"] for c in state["cookies"]}


def test_only_site_keeps_the_site_and_its_subdomains():
    fb = only_site(MIXED, "facebook.com")
    assert names(fb) == {"fb", "m"}
    assert [o["origin"] for o in fb["origins"]] == ["https://www.facebook.com"]
    assert names(only_site(MIXED, "google.com")) == {"g"}


async def test_each_site_saves_only_its_own_cookies(db):
    store = SessionStore(async_sessionmaker(db, expire_on_commit=False), VAULT)
    user = await make_user(db)

    assert await store.save(user, "facebook.com", MIXED, source="agent_login")
    assert names(await store.load(user, "facebook.com")) == {"fb", "m"}
    # Nothing of the site's own: nothing saved, and it says so.
    assert not await store.save(user, "github.com", MIXED, source="agent_login")
    assert not await store.has_active(user, "github.com")
    assert await store.has_active(user, "facebook.com")


def test_cookies_for_cdp_drop_session_expiry():
    cdp = as_cdp_cookies(MIXED["cookies"][:3])
    assert "expires" not in cdp[0] and cdp[2]["expires"] == 1.9e9


class FakeCtx:
    def __init__(self, user_id: uuid.UUID, decision: str) -> None:
        self.user_id, self.task_id, self.decision = user_id, None, decision
        self.cards: list[dict] = []
        self.sites: list[str] = []

    async def ask(self, kind, card):
        self.cards.append({"kind": kind, **card})
        return {"decision": self.decision}

    def use_site(self, site):
        self.sites.append(site)


class FakeBrowser:
    def __init__(self) -> None:
        self.cookies: list[dict] = []

    async def _cdp_set_cookies(self, cookies):
        self.cookies += cookies


async def google_saved(db):
    store = SessionStore(async_sessionmaker(db, expire_on_commit=False), VAULT)
    user = await make_user(db)
    await store.save(user, "google.com", MIXED, source="live_login")
    return store, user


async def test_google_login_loads_only_after_approval(db):
    store, user = await google_saved(db)

    ctx, browser, google = FakeCtx(user, "reject"), FakeBrowser(), {"loaded": False}
    note = await load_google_login(ctx, store, browser, "vercel.com", google)
    assert "said no" in note and browser.cookies == [] and not google["loaded"]
    assert ctx.cards[0]["kind"] == "confirm" and "vercel.com" in ctx.cards[0]["title"]

    ctx = FakeCtx(user, "approve")
    note = await load_google_login(ctx, store, browser, "vercel.com", google)
    assert "loaded" in note and google["loaded"]
    assert {c["value"] for c in browser.cookies} == {"g"}  # only Google's own cookies
    assert ctx.sites == ["google.com"]  # revoking Google stops the task

    # Asked once per task.
    assert "already" in await load_google_login(ctx, store, browser, "vercel.com", google)
    assert len(ctx.cards) == 1


def test_google_rule_names_the_action():
    assert "sign_in_with_google" in GOOGLE_RULE
