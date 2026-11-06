from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.auth import CurrentUser
from app.errors import APIError
from app.models import Task, User, UserPhone
from app.phone import PhoneTokenError
from app.profile import InvalidProfile
from app.schemas import UserOut

router = APIRouter(tags=["users"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> User:
    return user


# ---- settings + usage (read-only, for the Settings page) ---------------------

MODEL_NAMES = {
    "claude-sonnet-5-5": "Claude Sonnet 5.5",
    "claude-sonnet-5": "Claude Sonnet 5",
    "claude-opus-5-5": "Claude Opus 5.5",
    "claude-haiku-5-5": "Claude Haiku 5.5",
}


@router.get("/settings")
async def app_settings(request: Request, user: CurrentUser) -> dict[str, Any]:
    """The models and limits every task runs with. Same for all users for now."""
    s = request.app.state.settings
    model = lambda m: {"id": m, "name": MODEL_NAMES.get(m, m), "provider": "Anthropic"}  # noqa: E731
    return {
        "models": {"orchestrator": model(s.llm_model), "browser": model(s.browser_llm_model)},
        "limits": {
            "cost_per_task_usd": s.max_cost_per_task_usd,
            "cost_per_day_usd": s.max_cost_per_user_day_usd,
            "browser_steps": s.browser_max_steps,
            "task_minutes": round(s.max_task_seconds / 60),
            "wait_minutes": round(s.waiting_timeout / 60),
        },
        "browser": "cloud" if s.browser_backend == "cloud" else "local",
    }


@router.get("/usage")
async def usage(request: Request, user: CurrentUser, days: int = 30) -> dict[str, Any]:
    """Spend and task counts for the last `days` days, with a per-day series."""
    days = max(1, min(days, 90))
    since = datetime.now(UTC) - timedelta(days=days)
    owned = (Task.user_id == user.id, Task.created_at >= since)
    duration = func.extract("epoch", Task.finished_at - Task.started_at)
    async with request.app.state.session_factory() as session:
        totals = (
            await session.execute(
                select(
                    func.count(),
                    func.count().filter(Task.status == "done"),
                    func.count().filter(Task.status == "failed"),
                    func.coalesce(func.sum(Task.cost_usd), 0),
                    func.avg(duration).filter(Task.finished_at.is_not(None)),
                ).where(*owned)
            )
        ).one()
        day = func.date_trunc("day", Task.created_at)
        rows = (
            await session.execute(
                select(day, func.count(), func.coalesce(func.sum(Task.cost_usd), 0))
                .where(*owned)
                .group_by(day)
                .order_by(day)
            )
        ).all()
    tasks, done, failed, cost, avg_seconds = totals
    return {
        "days": days,
        "tasks": tasks,
        "done": done,
        "failed": failed,
        "cost_usd": round(float(cost), 4),
        "avg_seconds": round(float(avg_seconds)) if avg_seconds is not None else None,
        "daily": [
            {"date": d.date().isoformat(), "tasks": n, "cost_usd": round(float(c), 4)}
            for d, n, c in rows
        ],
    }


# ---- details for forms (see app/profile.py) -----------------------------------


@router.get("/me/profile")
async def get_profile(request: Request, user: CurrentUser) -> dict[str, Any]:
    return {"details": await request.app.state.profiles.get(user.id)}


@router.put("/me/profile")
async def save_profile(request: Request, user: CurrentUser, body: dict[str, Any]) -> dict[str, Any]:
    try:
        details = await request.app.state.profiles.save(user.id, body.get("details") or {})
    except InvalidProfile as exc:
        raise APIError(400, "validation_error", str(exc)) from exc
    return {"details": details}


# ---- verified phone (Firebase Phone Auth; see app/phone.py) ------------------


class PhoneProof(BaseModel):
    id_token: str = Field(min_length=20, max_length=4096)


def _phone_out(row: UserPhone | None) -> dict[str, Any]:
    if row is None:
        return {"phone": None}
    return {"phone": {"label": row.label, "verified_at": row.verified_at.isoformat()}}


@router.get("/me/phone")
async def get_phone(request: Request, user: CurrentUser) -> dict[str, Any]:
    """The masked number, if verified, and whether verification is switched on."""
    row = await request.app.state.phones.get(user.id)
    return {**_phone_out(row), "verification": request.app.state.phone_verifier is not None}


@router.post("/me/phone")
async def verify_phone(request: Request, user: CurrentUser, body: PhoneProof) -> dict[str, Any]:
    verifier = request.app.state.phone_verifier
    if verifier is None:
        raise APIError(503, "phone_unavailable", "Phone verification isn't set up on this server.")
    try:
        phone = await verifier.verify(body.id_token)
    except PhoneTokenError as exc:
        raise APIError(400, "phone_not_verified", str(exc)) from exc
    row = await request.app.state.phones.save(user.id, phone)
    return _phone_out(row)


@router.delete("/me/phone", status_code=204)
async def remove_phone(request: Request, user: CurrentUser) -> Response:
    await request.app.state.phones.remove(user.id)
    return Response(status_code=204)
