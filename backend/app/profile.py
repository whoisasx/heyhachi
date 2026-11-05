"""The user's details for filling in forms on websites (Profile page).

Name, birthday, address and the like, so a task can fill a delivery or sign-up
form without stopping to ask. Stored encrypted like any other secret (one row per
user). The owner can read and edit them on the Profile page.

In a task, the identifying details go to the browser as `sensitive_data`
placeholders (the model sees `profile_full_name`, never the value), only on the
task's site. The few it needs to *choose* from a list (city, state, country,
gender, food preference) and the free-text notes are shown to it as plain text.
"""

import re
import uuid
from datetime import date
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.crypto import Vault
from app.models import UserProfile
from app.vault import audit

SITE, KIND = "profile", "details"  # encryption binding (crypto.aad)

# field -> max length. All optional.
FIELDS: dict[str, int] = {
    "full_name": 120,
    "date_of_birth": 10,  # YYYY-MM-DD
    "gender": 40,
    "email": 254,
    "address_line1": 200,
    "address_line2": 200,
    "landmark": 120,
    "city": 80,
    "state": 80,
    "postal_code": 12,
    "country": 80,
    "food_preference": 40,
    "notes": 500,
}
# Typed by placeholder only (the model never sees these values).
HIDDEN = (
    "full_name",
    "date_of_birth",
    "email",
    "address_line1",
    "address_line2",
    "landmark",
    "postal_code",
)
# Shown to the model as text: it has to pick them from lists, or read them.
SHOWN = ("city", "state", "country", "gender", "food_preference", "notes")

LABELS = {
    "full_name": "full name",
    "date_of_birth": "date of birth (YYYY-MM-DD)",
    "email": "email",
    "address_line1": "address line 1",
    "address_line2": "address line 2",
    "landmark": "landmark",
    "postal_code": "PIN / postal code",
    "city": "city",
    "state": "state",
    "country": "country",
    "gender": "gender",
    "food_preference": "food preference",
    "notes": "notes from the user",
}


class InvalidProfile(ValueError):
    pass


def clean_profile(data: dict[str, Any]) -> dict[str, str]:
    """Only known fields, trimmed strings, empty ones dropped."""
    extra = set(data) - set(FIELDS)
    if extra:
        raise InvalidProfile(f"Unknown fields: {sorted(extra)}")
    out: dict[str, str] = {}
    for name, limit in FIELDS.items():
        value = data.get(name)
        if value is None:
            continue
        if not isinstance(value, str):
            raise InvalidProfile(f"`{name}` must be text")
        value = re.sub(r"\s+", " ", value).strip() if name != "notes" else value.strip()
        if not value:
            continue
        if len(value) > limit:
            raise InvalidProfile(f"`{name}` is too long")
        out[name] = value
    if "date_of_birth" in out:
        try:
            born = date.fromisoformat(out["date_of_birth"])
        except ValueError as exc:
            raise InvalidProfile("Date of birth must be YYYY-MM-DD.") from exc
        if not date(1900, 1, 1) <= born <= date.today():
            raise InvalidProfile("Check the date of birth.")
    if "email" in out and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", out["email"]):
        raise InvalidProfile("That email doesn't look right.")
    if "postal_code" in out and not re.fullmatch(r"[A-Za-z0-9 -]{3,12}", out["postal_code"]):
        raise InvalidProfile("Check the PIN / postal code.")
    return out


def profile_placeholder(field: str) -> str:
    return f"profile_{field}"


def profile_rules(details: dict[str, str]) -> str:
    """Task rules about the user's details: placeholder names and the shown values."""
    if not details:
        return ""
    hidden = [profile_placeholder(f) for f in HIDDEN if f in details]
    shown = [f"{LABELS[f]}: {details[f]}" for f in SHOWN if f in details]
    lines = [
        "- The user saved their details for forms (delivery address, sign-up, contact). "
        "Use them instead of asking, only where a form asks for them."
    ]
    if hidden:
        lines.append(
            "  Type these placeholders exactly, e.g. <secret>"
            f"{hidden[0]}</secret>: " + ", ".join(hidden) + "."
        )
    if shown:
        lines.append("  Other details: " + "; ".join(shown) + ".")
    return "\n".join(lines) + "\n"


class ProfileStore:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession], vault: Vault) -> None:
        self.session_factory = session_factory
        self.vault = vault

    async def get(self, user_id: uuid.UUID) -> dict[str, str]:
        """The owner's details (for the Profile page)."""
        async with self.session_factory() as db:
            row = await db.get(UserProfile, user_id)
            if row is None:
                return {}
            return self.vault.open(row, user_id=user_id, site=SITE, kind=KIND)

    async def save(self, user_id: uuid.UUID, data: dict[str, Any]) -> dict[str, str]:
        clean = clean_profile(data)
        async with self.session_factory() as db:
            row = await db.get(UserProfile, user_id)
            if not clean:
                if row is not None:
                    await db.delete(row)
                    db.add(audit(user_id, "profile_updated", SITE, KIND))
                    await db.commit()
                return {}
            sealed = self.vault.seal(clean, user_id=user_id, site=SITE, kind=KIND)
            row = row or UserProfile(user_id=user_id)
            for column, value in sealed.columns().items():
                setattr(row, column, value)
            db.add(row)
            db.add(audit(user_id, "profile_updated", SITE, KIND))
            await db.commit()
        return clean

    async def for_task(
        self, user_id: uuid.UUID, site: str, task_id: uuid.UUID | None = None
    ) -> dict[str, str]:
        """Decrypted details for a task. Memory only; never log."""
        async with self.session_factory() as db:
            row = await db.get(UserProfile, user_id)
            if row is None:
                return {}
            details = self.vault.open(row, user_id=user_id, site=SITE, kind=KIND)
            db.add(audit(user_id, "profile_used", site, KIND, task_id=task_id))
            await db.commit()
        return details
