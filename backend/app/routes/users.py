from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Request
from sqlalchemy import func, select

from app.auth import CurrentUser
from app.models import Task, User
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
