"""Saved browser logins (cookies + localStorage), encrypted per user per site.

docs/SCHEMA.md §3.8. Every load and save is written to the audit log.
"""

import uuid
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.crypto import Vault
from app.models import AuditLog, BrowserSession

SESSION_KIND = "session"


def normalize_site(site: str) -> str:
    """'https://www.GitHub.com/login' -> 'github.com'."""
    site = site.strip().lower()
    for prefix in ("https://", "http://"):
        site = site.removeprefix(prefix)
    site = site.split("/", 1)[0].split(":", 1)[0]
    return site.removeprefix("www.")


class SessionStore:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession], vault: Vault) -> None:
        self.session_factory = session_factory
        self.vault = vault

    async def load(
        self, user_id: uuid.UUID, site: str, task_id: uuid.UUID | None = None
    ) -> dict[str, Any] | None:
        """The active saved login for this site, or None."""
        async with self.session_factory() as db:
            row = await db.scalar(
                select(BrowserSession).where(
                    BrowserSession.user_id == user_id,
                    BrowserSession.site == site,
                    BrowserSession.status == "active",
                )
            )
            if row is None:
                return None
            state = self.vault.open(row, user_id=user_id, site=site, kind=SESSION_KIND)
            row.last_used_at = func.now()
            db.add(_audit(user_id, "session_used", site, row.id, task_id))
            await db.commit()
            return state

    async def save(
        self,
        user_id: uuid.UUID,
        site: str,
        state: dict[str, Any],
        *,
        source: str,
        task_id: uuid.UUID | None = None,
    ) -> None:
        sealed = self.vault.seal(state, user_id=user_id, site=site, kind=SESSION_KIND)
        async with self.session_factory() as db:
            row = await db.scalar(
                select(BrowserSession).where(
                    BrowserSession.user_id == user_id, BrowserSession.site == site
                )
            )
            if row is None:
                row = BrowserSession(id=uuid.uuid4(), user_id=user_id, site=site, source=source)
                db.add(row)
            else:
                row.source = source
                row.status = "active"
            for column, value in sealed.columns().items():
                setattr(row, column, value)
            row.updated_at = func.now()
            db.add(_audit(user_id, "session_saved", site, row.id, task_id))
            await db.commit()

    async def mark_expired(self, user_id: uuid.UUID, site: str) -> None:
        async with self.session_factory() as db:
            await db.execute(
                update(BrowserSession)
                .where(BrowserSession.user_id == user_id, BrowserSession.site == site)
                .values(status="expired")
            )
            await db.commit()


def _audit(
    user_id: uuid.UUID, action: str, site: str, ref_id: uuid.UUID, task_id: uuid.UUID | None
) -> AuditLog:
    return AuditLog(
        user_id=user_id, action=action, site=site, kind=SESSION_KIND, ref_id=ref_id, task_id=task_id
    )
