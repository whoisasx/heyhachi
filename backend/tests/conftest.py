"""Test setup: a real Postgres (docker compose), migrated once, truncated per test.

Start the database first:  docker compose up -d   (from the repo root)
Override with TEST_DATABASE_URL if needed.
"""

import asyncio
import json
import os
import subprocess
import sys
import time
import uuid
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

import httpx
import jwt
import pytest
from asgi_lifespan import LifespanManager
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import Settings, to_asyncpg_url
from app.main import create_app

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_DB_URL = to_asyncpg_url(
    os.environ.get(
        "TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5433/browser_agent_test"
    )
)
JWT_SECRET = "test-secret-0123456789abcdef0123456789abcdef"
TABLES = (
    "task_inputs, task_events, messages, tasks, conversations, "
    "credentials, sessions, audit_log, users"
)


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "database_url": TEST_DB_URL,
        "backend_jwt_secret": JWT_SECRET,
        "executor": "fake",
        "fake_step_delay": 0.0,
        "heartbeat_interval": 0.2,
        "waiting_timeout": 30.0,
        "messages_per_minute": 1000,
        "sse_ping_interval": 0.5,
    }
    values.update(overrides)
    return Settings(**values)


def make_token(sub: str = "google-user-1", email: str = "adil@example.com", **claims: Any) -> str:
    now = int(time.time())
    payload = {
        "sub": sub,
        "email": email,
        "name": "Adil",
        "aud": "browser-agent-api",
        "iat": now,
        "exp": now + 900,
        **claims,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> None:
    """Recreate the schema and run Alembic migrations once per test session."""

    async def reset() -> None:
        engine = create_async_engine(TEST_DB_URL)
        async with engine.begin() as conn:
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
        await engine.dispose()

    asyncio.run(reset())
    env = {**os.environ, "DATABASE_URL": TEST_DB_URL}
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env=env,
        check=True,
        capture_output=True,
    )


@pytest.fixture
async def db():
    """An engine for arranging and inspecting rows directly. Tables are emptied first."""
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE"))
    yield engine
    await engine.dispose()


AppFactory = Callable[..., Any]


@pytest.fixture
async def make_client(db) -> AsyncIterator[AppFactory]:
    """Start the app (with lifespan: runner + recovery) and return an HTTP client."""
    managers: list[tuple[LifespanManager, httpx.AsyncClient]] = []

    async def factory(executor=None, **setting_overrides: Any) -> httpx.AsyncClient:
        app = create_app(make_settings(**setting_overrides), executor=executor)
        manager = LifespanManager(app)
        await manager.__aenter__()
        client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=manager.app),
            base_url="http://test/v1",
            headers={"Authorization": f"Bearer {make_token()}"},
        )
        client.app = app  # type: ignore[attr-defined]
        managers.append((manager, client))
        return client

    yield factory
    for manager, client in reversed(managers):
        await client.aclose()
        await manager.__aexit__(None, None, None)


@pytest.fixture
async def client(make_client) -> httpx.AsyncClient:
    return await make_client()


# ---- helpers -----------------------------------------------------------------


async def start_task(client: httpx.AsyncClient, content: str) -> tuple[str, str]:
    conv = (await client.post("/conversations")).json()
    resp = await client.post(
        f"/conversations/{conv['id']}/messages",
        json={"content": content, "client_message_id": str(uuid.uuid4())},
    )
    assert resp.status_code == 202, resp.text
    return conv["id"], resp.json()["task"]["id"]


async def wait_for_status(
    client: httpx.AsyncClient, task_id: str, *statuses: str, within: float = 5.0
) -> dict:
    deadline = time.monotonic() + within
    while True:
        task = (await client.get(f"/tasks/{task_id}")).json()
        if task["status"] in statuses:
            return task
        if time.monotonic() > deadline:
            raise AssertionError(f"task stuck in {task['status']}, wanted {statuses}")
        await asyncio.sleep(0.02)


def parse_sse(body: str) -> list[dict]:
    """Parse an SSE body into [{id, event, data}], ignoring comments."""
    events = []
    for block in body.strip().split("\n\n"):
        fields: dict[str, Any] = {}
        for line in block.splitlines():
            if not line or line.startswith(":"):
                continue
            key, _, value = line.partition(": ")
            fields[key] = value
        if fields:
            events.append(
                {
                    "id": int(fields["id"]),
                    "event": fields["event"],
                    "data": json.loads(fields["data"]),
                }
            )
    return events


async def read_events(client: httpx.AsyncClient, task_id: str, **kwargs: Any) -> list[dict]:
    resp = await client.get(f"/tasks/{task_id}/events", timeout=10, **kwargs)
    assert resp.status_code == 200, resp.text
    return parse_sse(resp.text)
