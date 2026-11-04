"""Vault routes (docs/API.md §6). Values go in; only metadata comes out."""

import uuid
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel, Field

from app.auth import CurrentUser
from app.browser_sessions import normalize_site
from app.errors import APIError, not_found
from app.models import Task
from app.routes.tasks import check_waiting, store_input
from app.vault import InvalidSecret

router = APIRouter(tags=["vault"])


class ForTask(BaseModel):
    task_id: uuid.UUID
    card_seq: int


class CredentialIn(BaseModel):
    site: str = Field(min_length=1, max_length=253)
    kind: Literal["password", "totp", "api_key", "card"]
    secret: dict[str, Any]
    for_task: ForTask | None = None


class CredentialOut(BaseModel):
    id: uuid.UUID
    site: str
    kind: str
    label: str
    created_at: datetime


@router.get("/vault")
async def list_vault(request: Request, user: CurrentUser) -> dict[str, Any]:
    return {"sites": await request.app.state.credentials.list_sites(user.id)}


@router.post("/vault/credentials", status_code=201, response_model=CredentialOut)
async def add_credential(body: CredentialIn, request: Request, user: CurrentUser) -> CredentialOut:
    state = request.app.state
    site = normalize_site(body.site)
    if not site or "." not in site:
        raise APIError(422, "validation_error", "site must be a domain like github.com")

    task = None
    if body.for_task is not None:  # check before storing, so a bad card stores nothing
        async with state.session_factory() as session:
            task = await session.get(Task, body.for_task.task_id)
        if task is None or task.user_id != user.id:
            raise not_found()
        check_waiting(task, body.for_task.card_seq, "credential_ready")

    try:
        row = await state.credentials.save(user.id, site, body.kind, body.secret)
    except InvalidSecret as exc:
        raise APIError(422, exc.code, str(exc)) from None  # never echo the value

    if task is not None:
        await store_input(
            state,
            task,
            user.id,
            kind="credential_ready",
            card_seq=body.for_task.card_seq,
            data={"site": site, "kind": body.kind},
        )
    return CredentialOut(
        id=row.id, site=row.site, kind=row.kind, label=row.label, created_at=row.created_at
    )


@router.delete("/vault/credentials/{credential_id}", status_code=204)
async def delete_credential(
    credential_id: uuid.UUID, request: Request, user: CurrentUser
) -> Response:
    row = await request.app.state.credentials.delete(user.id, credential_id)
    if row is None:
        raise not_found()
    return Response(status_code=204)


@router.delete("/vault/sites/{site}", status_code=204)
async def revoke_site(site: str, request: Request, user: CurrentUser) -> Response:
    """Revoke: delete everything stored for the site and stop tasks using it."""
    state = request.app.state
    site = normalize_site(site)
    await state.credentials.revoke_site(user.id, site)
    await state.runner.revoke_site(user.id, site)
    return Response(status_code=204)


@router.get("/vault/audit")
async def audit_log(
    request: Request,
    user: CurrentUser,
    limit: int = Query(50, ge=1, le=200),
    before: int | None = Query(None, ge=1),
) -> dict[str, Any]:
    rows, next_cursor = await request.app.state.credentials.audit_log(user.id, limit, before)
    return {
        "items": [
            {
                "action": r.action,
                "site": r.site,
                "kind": r.kind,
                "task_id": r.task_id,
                "at": r.at,
            }
            for r in rows
        ],
        "next_cursor": str(next_cursor) if next_cursor else None,
    }
