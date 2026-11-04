"""Standalone live-view logins from the Connected accounts page (docs/API.md §6).

The user opens a browser on a site, logs in themselves, then clicks Done: the
cookies are encrypted and saved as the site's session. Their password never
reaches us. Logins left open close after 10 minutes. In development the browser
is a visible Chrome window on this machine (no live_view_url).
"""

import asyncio
import contextlib
import logging
import tempfile
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from app.browser_sessions import SessionStore
from app.config import Settings

log = logging.getLogger(__name__)

LOGIN_TTL = timedelta(minutes=10)


def _same_site(cookie_domain: str, site: str) -> bool:
    domain = cookie_domain.lstrip(".").lower()
    return domain == site or domain.endswith("." + site)


class LiveLoginError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass
class _Login:
    id: uuid.UUID
    user_id: uuid.UUID
    site: str
    expires_at: datetime
    browser: Any
    profile_dir: tempfile.TemporaryDirectory
    timer: asyncio.Task | None = field(default=None, repr=False)


class LiveLoginManager:
    def __init__(self, settings: Settings, sessions: SessionStore) -> None:
        self.settings = settings
        self.sessions = sessions
        self._logins: dict[uuid.UUID, _Login] = {}

    async def start(self, user_id: uuid.UUID, site: str) -> dict[str, Any]:
        if self.settings.browser_backend != "local":
            raise LiveLoginError("browser_unavailable", "No browser is connected in this build.")
        from browser_use import BrowserProfile, BrowserSession

        # One open login per user and site.
        for login in list(self._logins.values()):
            if login.user_id == user_id and login.site == site:
                await self._close(login.id)

        profile_dir = tempfile.TemporaryDirectory(prefix="ba-login-")
        browser = BrowserSession(
            browser_profile=BrowserProfile(
                headless=False, user_data_dir=profile_dir.name, keep_alive=False
            )
        )
        try:
            await browser.start()
            await browser.navigate_to(f"https://{site}")
        except Exception:
            await browser.kill()
            profile_dir.cleanup()
            raise
        login = _Login(
            id=uuid.uuid4(),
            user_id=user_id,
            site=site,
            expires_at=datetime.now(UTC) + LOGIN_TTL,
            browser=browser,
            profile_dir=profile_dir,
        )
        login.timer = asyncio.create_task(self._expire(login.id))
        self._logins[login.id] = login
        return {
            "id": login.id,
            "site": site,
            "live_view_url": None,  # dev: the window on this machine is the live view
            "expires_at": login.expires_at,
        }

    def _get(self, login_id: uuid.UUID, user_id: uuid.UUID) -> _Login:
        login = self._logins.get(login_id)
        if login is None or login.user_id != user_id:
            raise LiveLoginError("not_found", "That login isn't open anymore.")
        return login

    async def complete(self, login_id: uuid.UUID, user_id: uuid.UUID) -> dict[str, Any]:
        login = self._get(login_id, user_id)
        state = await login.browser.export_storage_state()
        site_cookies = [
            c for c in state.get("cookies", []) if _same_site(str(c.get("domain", "")), login.site)
        ]
        if not site_cookies:
            raise LiveLoginError(
                "not_logged_in", f"It doesn't look like you're logged in to {login.site}."
            )
        await self.sessions.save(user_id, login.site, state, source="live_login")
        await self._close(login_id)
        return {"site": login.site, "status": "active", "source": "live_login"}

    async def cancel(self, login_id: uuid.UUID, user_id: uuid.UUID) -> None:
        self._get(login_id, user_id)
        await self._close(login_id)

    async def _expire(self, login_id: uuid.UUID) -> None:
        await asyncio.sleep(LOGIN_TTL.total_seconds())
        log.info("live login %s expired", login_id)
        await self._close(login_id, from_timer=True)

    async def _close(self, login_id: uuid.UUID, from_timer: bool = False) -> None:
        login = self._logins.pop(login_id, None)
        if login is None:
            return
        if login.timer and not from_timer:
            login.timer.cancel()
        with contextlib.suppress(Exception):
            await login.browser.kill()
        login.profile_dir.cleanup()

    async def shutdown(self) -> None:
        for login_id in list(self._logins):
            await self._close(login_id)
