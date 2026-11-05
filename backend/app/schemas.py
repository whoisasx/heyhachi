"""Request and response bodies (docs/API.md)."""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserOut(_Out):
    id: uuid.UUID
    email: str
    name: str | None
    avatar_url: str | None


class ConversationSummary(_Out):
    id: uuid.UUID
    title: str | None
    updated_at: datetime
    active_task_id: uuid.UUID | None = None
    active_task_status: str | None = None  # "waiting_user" = needs you


class ConversationList(BaseModel):
    items: list[ConversationSummary]
    next_cursor: str | None


class ConversationCreated(_Out):
    id: uuid.UUID
    title: str | None
    created_at: datetime


class MessageOut(_Out):
    id: uuid.UUID
    role: str
    content: str
    task_id: uuid.UUID | None = None
    created_at: datetime


class TaskBrief(_Out):
    id: uuid.UUID
    status: str
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    cost_usd: float = 0


class ConversationDetail(BaseModel):
    id: uuid.UUID
    title: str | None
    messages: list[MessageOut]
    tasks: list[TaskBrief]


class RenameConversation(BaseModel):
    title: str = Field(min_length=1, max_length=80)


class SendMessage(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    client_message_id: uuid.UUID


class TaskRef(BaseModel):
    id: uuid.UUID
    status: str
    events_url: str


class MessageAccepted(BaseModel):
    message: MessageOut
    task: TaskRef


class TaskOut(_Out):
    id: uuid.UUID
    conversation_id: uuid.UUID
    status: str
    waiting_for: dict[str, Any] | None
    result: dict[str, Any] | None
    error: dict[str, Any] | None
    attempt: int
    created_at: datetime
    finished_at: datetime | None


class TaskInputIn(BaseModel):
    card_seq: int
    kind: Literal["otp", "confirm", "answer", "credential_ready"]
    data: dict[str, Any] | None = None
    secret: str | None = Field(default=None, max_length=64)


class RetryIn(BaseModel):
    mode: Literal["resume", "restart"]


class Accepted(BaseModel):
    accepted: bool = True
