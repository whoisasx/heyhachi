"""Verified phone number on the user's profile.

The browser proves the number with Firebase Phone Auth (Google sends the SMS
code). It then sends us the Firebase ID token; we check its signature and
claims here and keep only the number, encrypted like any other secret.
"""

import asyncio
import re
import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import jwt
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.crypto import Vault
from app.models import UserPhone
from app.vault import audit

FIREBASE_JWKS = (
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
)
MAX_TOKEN_AGE_SECONDS = 600  # the SMS check must have happened in the last 10 minutes
E164 = re.compile(r"^\+[1-9]\d{6,14}$")

# Encryption binding for the number (crypto.aad): not a website, the profile.
SITE, KIND = "profile", "phone"


class PhoneTokenError(ValueError):
    pass


class PhoneVerifier:
    """Checks a Firebase ID token from a phone sign-in and returns the number."""

    def __init__(self, project_id: str, key_for: Callable[[str], Any] | None = None) -> None:
        self.project_id = project_id
        if key_for is None:
            client = jwt.PyJWKClient(FIREBASE_JWKS, cache_keys=True)
            key_for = lambda token: client.get_signing_key_from_jwt(token).key  # noqa: E731
        self._key_for = key_for

    async def verify(self, id_token: str) -> str:
        try:
            key = await asyncio.to_thread(self._key_for, id_token)  # fetches Google's keys
            claims = jwt.decode(
                id_token,
                key,
                algorithms=["RS256"],
                audience=self.project_id,
                issuer=f"https://securetoken.google.com/{self.project_id}",
                options={"require": ["exp", "iat", "sub", "auth_time"]},
                leeway=30,
            )
        except jwt.PyJWTError as exc:
            raise PhoneTokenError("The verification didn't check out. Try again.") from exc

        phone = claims.get("phone_number")
        provider = (claims.get("firebase") or {}).get("sign_in_provider")
        if provider != "phone" or not isinstance(phone, str) or not E164.match(phone):
            raise PhoneTokenError("That wasn't a phone verification.")
        if time.time() - float(claims["auth_time"]) > MAX_TOKEN_AGE_SECONDS:
            raise PhoneTokenError("That code is too old. Verify again.")
        return phone


def mask_phone(phone: str) -> str:
    """'+919773703018' -> '+91 ••••• •3018'. Assumes a 10-digit national number."""
    country = phone[1:-10] if len(phone) > 11 else ""
    return f"+{country} ••••• •{phone[-4:]}" if country else f"••••• •{phone[-4:]}"


class PhoneStore:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession], vault: Vault) -> None:
        self.session_factory = session_factory
        self.vault = vault

    async def get(self, user_id: uuid.UUID) -> UserPhone | None:
        async with self.session_factory() as db:
            return await db.get(UserPhone, user_id)

    async def save(self, user_id: uuid.UUID, phone: str) -> UserPhone:
        sealed = self.vault.seal({"phone": phone}, user_id=user_id, site=SITE, kind=KIND)
        async with self.session_factory() as db:
            row = await db.get(UserPhone, user_id) or UserPhone(user_id=user_id)
            row.label = mask_phone(phone)
            for column, value in sealed.columns().items():
                setattr(row, column, value)
            row.verified_at = datetime.now(UTC)
            db.add(row)
            db.add(audit(user_id, "phone_verified", SITE, KIND))
            await db.commit()
            await db.refresh(row)
            return row

    async def remove(self, user_id: uuid.UUID) -> bool:
        async with self.session_factory() as db:
            result = await db.execute(delete(UserPhone).where(UserPhone.user_id == user_id))
            if result.rowcount:
                db.add(audit(user_id, "phone_removed", SITE, KIND))
            await db.commit()
            return bool(result.rowcount)

    async def reveal(self, user_id: uuid.UUID, task_id: uuid.UUID | None = None) -> str | None:
        """The decrypted number, for a task that logs in with it. Memory only; never log."""
        async with self.session_factory() as db:
            row = await db.scalar(select(UserPhone).where(UserPhone.user_id == user_id))
            if row is None:
                return None
            value = self.vault.open(row, user_id=user_id, site=SITE, kind=KIND)
            db.add(audit(user_id, "phone_used", SITE, KIND, task_id=task_id))
            await db.commit()
        return value["phone"]
