# Browser Agent

A chat assistant that does tasks on real websites using a background cloud browser, and manages access to those sites safely: passwords, TOTP 2FA, SMS OTPs, API keys, saved sessions, and revocation. Secrets never appear in chat or model input.

Status: phase 4.1 (backend skeleton) done. See [PLAN.md](docs/PLAN.md) for progress.

- [Plan](docs/PLAN.md): demo scenarios, keys, build phases
- [Architecture](docs/ARCHITECTURE.md): components, task lifecycle, data model, crash recovery, secrets
- [Schema](docs/SCHEMA.md): database tables, JSON shapes, event types
- [API](docs/API.md): HTTP routes, SSE stream, auth, errors

## Stack

Next.js + Auth.js (Google) on Vercel · FastAPI (Python) on Railway · Postgres (Neon) · Claude API · browser-use on Browser Use Cloud

## Setup

Needs Docker, [uv](https://docs.astral.sh/uv/) and Python 3.12.

```bash
cp .env.example .env          # then fill in the keys
docker compose up -d          # local Postgres on port 5433 (+ a test database)
cd backend
uv sync                       # install dependencies
uv run alembic upgrade head   # create tables
uv run uvicorn app.main:app --reload --port 8000
```

API docs (OpenAPI) at http://localhost:8000/docs.

## Tests

```bash
cd backend
uv run pytest                 # needs `docker compose up -d`
uv run ruff check . && uv run ruff format --check .
```

## Repo layout

```
backend/
  app/
    main.py          app setup, lifespan (starts the runner, runs crash recovery)
    config.py        settings from .env
    models.py        SQLAlchemy models (docs/SCHEMA.md)
    auth.py          backend token check, user upsert
    events.py        state change + events in one transaction
    relay.py         in-memory pub/sub for SSE
    runner.py        task runner, TaskContext, recovery, heartbeat
    executors/       what a task actually does (fake for now; orchestrator in 4.2)
    routes/          HTTP routes (docs/API.md)
    secret_scan.py   blocks secrets pasted into chat
  alembic/           migrations
  tests/
docs/                plan, architecture, schema, API
```
