"""Credential vault: values go in, only metadata comes out (docs/API.md §6).

Secrets are decrypted just in time inside the task runner, and handed to the
browser as `sensitive_data` placeholders, so the model only sees names like
`github.com_password`, never values (ARCHITECTURE §8.2).
"""

import re
import uuid
from typing import Any

import pyotp
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.crypto import Vault
from app.models import AuditLog, BrowserSession, Credential

SECRET_FIELDS: dict[str, tuple[str, ...]] = {
    "password": ("username", "password"),
    "totp": ("secret",),
    "api_key": ("key",),
    "card": ("number", "expiry", "name"),
}


# Fields that may be left empty: some sites log in with a phone number and an
# SMS code, no password.
OPTIONAL_FIELDS: dict[str, tuple[str, ...]] = {"password": ("password",)}


class InvalidSecret(ValueError):
    """Bad secret shape. The message never contains the value."""

    def __init__(self, message: str, code: str = "validation_error") -> None:
        super().__init__(message)
        self.code = code


def clean_secret(kind: str, secret: dict[str, Any]) -> dict[str, str]:
    """Check the shape for `kind` and return only the allowed, trimmed string fields."""
    if kind not in SECRET_FIELDS:
        raise InvalidSecret(f"kind must be one of {list(SECRET_FIELDS)}")
    if kind == "card" and any(k.lower() in ("cvv", "cvc", "cvv2", "csc") for k in secret):
        raise InvalidSecret("Card security codes (CVV) are never stored.")
    extra = set(secret) - set(SECRET_FIELDS[kind])
    if extra:
        raise InvalidSecret(f"Unexpected fields for {kind}: {sorted(extra)}")
    out: dict[str, str] = {}
    for field in SECRET_FIELDS[kind]:
        value = secret.get(field)
        if field in OPTIONAL_FIELDS.get(kind, ()) and (value is None or value == ""):
            continue
        if not isinstance(value, str) or not value.strip():
            raise InvalidSecret(f"`{field}` is required for {kind}")
        out[field] = value.strip()
    if kind == "totp":
        out["secret"] = re.sub(r"[\s-]", "", out["secret"]).upper()
        try:
            pyotp.TOTP(out["secret"]).now()
        except Exception as exc:
            raise InvalidSecret(
                "That doesn't look like an authenticator setup key.", "invalid_totp_secret"
            ) from exc
    if kind == "card":
        digits = re.sub(r"[\s-]", "", out["number"])
        if not digits.isdigit() or not 12 <= len(digits) <= 19:
            raise InvalidSecret("Card number must be 12-19 digits.")
        if not re.fullmatch(r"(0[1-9]|1[0-2])/\d{2}", out["expiry"]):
            raise InvalidSecret("Expiry must be MM/YY.")
        out["number"] = digits
    return out


def _mask_email(username: str) -> str:
    if "@" in username:
        name, _, domain = username.partition("@")
        return f"{name[:4]}…@{domain}" if len(name) > 4 else f"{name[:1]}…@{domain}"
    return f"{username[:3]}…" if len(username) > 3 else "…"


def make_label(kind: str, secret: dict[str, str], site: str) -> str:
    """Safe display text, never enough to reconstruct the secret."""
    if kind == "password":
        return f"{_mask_email(secret['username'])} · {site}"
    if kind == "totp":
        return "Authenticator app"
    if kind == "api_key":
        key = secret["key"]
        return f"{key[:5]}…{key[-4:]}" if len(key) >= 16 else "API key"
    if kind == "card":
        return f"Card ••{secret['number'][-4:]}"
    raise ValueError(kind)


def audit(
    user_id: uuid.UUID,
    action: str,
    site: str | None,
    kind: str | None = None,
    ref_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
) -> AuditLog:
    return AuditLog(
        user_id=user_id, action=action, site=site, kind=kind, ref_id=ref_id, task_id=task_id
    )


def placeholder_names(site: str) -> dict[str, list[str]]:
    """Placeholder names the browser model can use, by credential kind (no values)."""
    return {
        "password": [f"{site}_username", f"{site}_password"],
        "totp": [f"{site}_bu_2fa_code"],  # browser-use generates the current code
        "api_key": [f"{site}_api_key"],
        "card": [f"{site}_card_number", f"{site}_card_expiry", f"{site}_card_name"],
    }


class CredentialStore:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession], vault: Vault) -> None:
        self.session_factory = session_factory
        self.vault = vault

    async def save(
        self, user_id: uuid.UUID, site: str, kind: str, secret: dict[str, Any]
    ) -> Credential:
        """Store (or replace) the user's `kind` credential for `site`."""
        clean = clean_secret(kind, secret)
        sealed = self.vault.seal(clean, user_id=user_id, site=site, kind=kind)
        async with self.session_factory() as db:
            row = await db.scalar(
                select(Credential).where(
                    Credential.user_id == user_id, Credential.site == site, Credential.kind == kind
                )
            )
            action = "credential_updated"
            if row is None:
                row = Credential(id=uuid.uuid4(), user_id=user_id, site=site, kind=kind)
                db.add(row)
                action = "credential_added"
            row.label = make_label(kind, clean, site)
            for column, value in sealed.columns().items():
                setattr(row, column, value)
            row.updated_at = func.now()
            db.add(audit(user_id, action, site, kind, row.id))
            await db.commit()
            await db.refresh(row)
            return row

    async def list_sites(self, user_id: uuid.UUID) -> list[dict[str, Any]]:
        async with self.session_factory() as db:
            creds = (
                await db.scalars(
                    select(Credential)
                    .where(Credential.user_id == user_id)
                    .order_by(Credential.site, Credential.kind)
                )
            ).all()
            sessions = (
                await db.scalars(select(BrowserSession).where(BrowserSession.user_id == user_id))
            ).all()
        sites: dict[str, dict[str, Any]] = {}

        def entry(site: str) -> dict[str, Any]:
            return sites.setdefault(site, {"site": site, "credentials": [], "session": None})

        for c in creds:
            entry(c.site)["credentials"].append(
                {
                    "id": c.id,
                    "kind": c.kind,
                    "label": c.label,
                    "created_at": c.created_at,
                    "last_used_at": c.last_used_at,
                }
            )
        for s in sessions:
            entry(s.site)["session"] = {
                "id": s.id,
                "status": s.status,
                "source": s.source,
                "updated_at": s.updated_at,
            }
        return [sites[k] for k in sorted(sites)]

    async def delete(self, user_id: uuid.UUID, credential_id: uuid.UUID) -> Credential | None:
        async with self.session_factory() as db:
            row = await db.scalar(
                select(Credential).where(
                    Credential.id == credential_id, Credential.user_id == user_id
                )
            )
            if row is None:
                return None
            await db.delete(row)
            db.add(audit(user_id, "credential_revoked", row.site, row.kind, row.id))
            await db.commit()
            return row

    async def revoke_site(self, user_id: uuid.UUID, site: str) -> int:
        """Delete every credential and the session for `site`. Returns how many were removed."""
        async with self.session_factory() as db:
            creds = (
                await db.execute(
                    delete(Credential)
                    .where(Credential.user_id == user_id, Credential.site == site)
                    .returning(Credential.id, Credential.kind)
                )
            ).all()
            sessions = (
                await db.execute(
                    delete(BrowserSession)
                    .where(BrowserSession.user_id == user_id, BrowserSession.site == site)
                    .returning(BrowserSession.id)
                )
            ).all()
            for cred_id, kind in creds:
                db.add(audit(user_id, "credential_revoked", site, kind, cred_id))
            for (session_id,) in sessions:
                db.add(audit(user_id, "session_revoked", site, "session", session_id))
            await db.commit()
        return len(creds) + len(sessions)

    async def browser_secrets(
        self, user_id: uuid.UUID, site: str, task_id: uuid.UUID | None = None
    ) -> dict[str, str]:
        """Decrypted values for the site, keyed by placeholder name. Memory only; never log."""
        names = placeholder_names(site)
        out: dict[str, str] = {}
        async with self.session_factory() as db:
            rows = (
                await db.scalars(
                    select(Credential).where(Credential.user_id == user_id, Credential.site == site)
                )
            ).all()
            for row in rows:
                value = self.vault.open(row, user_id=user_id, site=site, kind=row.kind)
                fields = SECRET_FIELDS[row.kind]
                for name, field in zip(names[row.kind], fields, strict=False):
                    if value.get(field):  # optional fields may be missing
                        out[name] = value[field]
                row.last_used_at = func.now()
                db.add(audit(user_id, "credential_used", site, row.kind, row.id, task_id))
            await db.commit()
        return out

    async def api_key(
        self, user_id: uuid.UUID, site: str, task_id: uuid.UUID | None = None
    ) -> str | None:
        """The site's decrypted API key for a backend API call, or None. Never log it."""
        async with self.session_factory() as db:
            row = await db.scalar(
                select(Credential).where(
                    Credential.user_id == user_id,
                    Credential.site == site,
                    Credential.kind == "api_key",
                )
            )
            if row is None:
                return None
            value = self.vault.open(row, user_id=user_id, site=site, kind="api_key")
            row.last_used_at = func.now()
            db.add(audit(user_id, "credential_used", site, "api_key", row.id, task_id))
            await db.commit()
        return value["key"]

    async def audit_log(
        self, user_id: uuid.UUID, limit: int = 50, before: int | None = None
    ) -> tuple[list[AuditLog], int | None]:
        query = select(AuditLog).where(AuditLog.user_id == user_id)
        if before is not None:
            query = query.where(AuditLog.id < before)
        async with self.session_factory() as db:
            rows = (await db.scalars(query.order_by(AuditLog.id.desc()).limit(limit + 1))).all()
        more = len(rows) > limit
        rows = rows[:limit]
        return rows, (rows[-1].id if more else None)
