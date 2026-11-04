"""SQLAlchemy models. Source of truth: docs/SCHEMA.md."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

TASK_STATUSES = ("queued", "running", "waiting_user", "verifying", "done", "failed", "cancelled")
TERMINAL_STATUSES = ("done", "failed", "cancelled")
ACTIVE_STATUSES = tuple(s for s in TASK_STATUSES if s not in TERMINAL_STATUSES)

EVENT_TYPES = ("status", "progress", "live_view", "card", "card_resolved", "reply", "error")
INPUT_KINDS = ("otp", "confirm", "answer", "credential_ready")
CREDENTIAL_KINDS = ("password", "totp", "api_key", "card")
AUDIT_ACTIONS = (
    "credential_added",
    "credential_updated",
    "credential_used",
    "credential_revoked",
    "session_saved",
    "session_used",
    "session_revoked",
    "secret_pasted_in_chat",
)


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{v}'" for v in values)
    return f"{column} IN ({quoted})"


class Base(DeclarativeBase):
    # none_as_null: Python None must become SQL NULL (not JSON 'null'), or
    # checks like "waiting_for IS NOT NULL" break.
    type_annotation_map = {
        dict[str, Any]: JSONB(none_as_null=True),
        uuid.UUID: UUID(as_uuid=True),
    }


def _pk() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, default=uuid.uuid4)


def _created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


def _updated() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


def _user_fk() -> Mapped[uuid.UUID]:
    return mapped_column(ForeignKey("users.id", ondelete="CASCADE"))


class EncryptedMixin:
    """Envelope-encryption columns (docs/SCHEMA.md §4)."""

    ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    nonce: Mapped[bytes] = mapped_column(LargeBinary)
    encrypted_dek: Mapped[bytes] = mapped_column(LargeBinary)
    dek_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[int] = mapped_column(SmallInteger, server_default=text("1"))


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _pk()
    google_sub: Mapped[str] = mapped_column(Text, unique=True)
    email: Mapped[str] = mapped_column(Text)
    name: Mapped[str | None] = mapped_column(Text)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created()
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (Index("ix_conversations_user_updated", "user_id", text("updated_at DESC")),)

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _user_fk()
    title: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint(_in("role", ("user", "assistant")), name="ck_messages_role"),
        UniqueConstraint("conversation_id", "client_message_id", name="uq_messages_client_id"),
        Index("ix_messages_conversation_created", "conversation_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = _pk()
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE")
    )
    role: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    client_message_id: Mapped[uuid.UUID | None]
    created_at: Mapped[datetime] = _created()


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint(_in("status", TASK_STATUSES), name="ck_tasks_status"),
        CheckConstraint(
            "(status = 'waiting_user') = (waiting_for IS NOT NULL)", name="ck_tasks_waiting_for"
        ),
        Index("ix_tasks_user_created", "user_id", text("created_at DESC")),
        Index(
            "ix_tasks_active_status",
            "status",
            postgresql_where=text(_in("status", ACTIVE_STATUSES)),
        ),
    )

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _user_fk()
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE")
    )
    status: Mapped[str] = mapped_column(Text)
    waiting_for: Mapped[dict[str, Any] | None]
    checkpoint: Mapped[dict[str, Any] | None]
    markers: Mapped[dict[str, Any]] = mapped_column(server_default=text("'{}'::jsonb"))
    browser_session_id: Mapped[str | None] = mapped_column(Text)
    worker_id: Mapped[str | None] = mapped_column(Text)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempt: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    last_event_seq: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    steps_used: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(10, 4), server_default=text("0"))
    result: Mapped[dict[str, Any] | None]
    error: Mapped[dict[str, Any] | None]
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TaskEvent(Base):
    __tablename__ = "task_events"
    __table_args__ = (
        CheckConstraint(_in("type", EVENT_TYPES), name="ck_task_events_type"),
        UniqueConstraint("task_id", "seq", name="uq_task_events_task_seq"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any]]
    created_at: Mapped[datetime] = _created()


class TaskInput(Base):
    __tablename__ = "task_inputs"
    __table_args__ = (
        CheckConstraint(_in("kind", INPUT_KINDS), name="ck_task_inputs_kind"),
        Index("ix_task_inputs_task_consumed", "task_id", "consumed_at"),
    )

    id: Mapped[uuid.UUID] = _pk()
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = _user_fk()
    kind: Mapped[str] = mapped_column(Text)
    card_seq: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict[str, Any] | None]
    # Secret values (OTP codes) only; wiped after use.
    ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    nonce: Mapped[bytes | None] = mapped_column(LargeBinary)
    encrypted_dek: Mapped[bytes | None] = mapped_column(LargeBinary)
    dek_nonce: Mapped[bytes | None] = mapped_column(LargeBinary)
    key_version: Mapped[int | None] = mapped_column(SmallInteger)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created()


class Credential(EncryptedMixin, Base):
    __tablename__ = "credentials"
    __table_args__ = (
        CheckConstraint(_in("kind", CREDENTIAL_KINDS), name="ck_credentials_kind"),
        UniqueConstraint("user_id", "site", "kind", name="uq_credentials_user_site_kind"),
    )

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _user_fk()
    site: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    label: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BrowserSession(EncryptedMixin, Base):
    __tablename__ = "sessions"
    __table_args__ = (
        CheckConstraint(_in("source", ("live_login", "agent_login")), name="ck_sessions_source"),
        CheckConstraint(_in("status", ("active", "expired")), name="ck_sessions_status"),
        UniqueConstraint("user_id", "site", name="uq_sessions_user_site"),
    )

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _user_fk()
    site: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default=text("'active'"))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = (
        CheckConstraint(_in("action", AUDIT_ACTIONS), name="ck_audit_log_action"),
        Index("ix_audit_log_user_at", "user_id", text("at DESC")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = _user_fk()
    action: Mapped[str] = mapped_column(Text)
    site: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str | None] = mapped_column(Text)
    ref_id: Mapped[uuid.UUID | None]
    task_id: Mapped[uuid.UUID | None]
    metadata_: Mapped[dict[str, Any] | None] = mapped_column("metadata")
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
