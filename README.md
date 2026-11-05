# Browser Agent

A chat assistant that does tasks on real websites using a background cloud browser, and manages access to those sites safely: passwords, TOTP 2FA, SMS OTPs, API keys, saved sessions, and revocation. Secrets never appear in chat or model input.

**Live:** https://browser-agent-drab.vercel.app (Google sign-in is in testing mode: only listed test users can sign in).

Status: phases 4.1–4.6 done and deployed; demo video and the live test run are left. See [PLAN.md](docs/PLAN.md).

- [Plan](docs/PLAN.md): demo scenarios, keys, build phases
- [Architecture](docs/ARCHITECTURE.md): components, task lifecycle, data model, crash recovery, secrets
- [Schema](docs/SCHEMA.md): database tables, JSON shapes, event types
- [API](docs/API.md): HTTP routes, SSE stream, auth, errors
- [Access management](docs/ACCESS.md): choices and known limits
- [Reliability test list](docs/RELIABILITY.md): manual end-to-end checks

## Stack

Next.js + Auth.js (Google) on Vercel · FastAPI (Python) on Railway · Postgres (Railway) · Claude API · browser-use on Browser Use Cloud

## Setup

Needs Docker, [uv](https://docs.astral.sh/uv/), Python 3.12, Node 20+, and Google Chrome (the browser agent drives it locally in development).

```bash
cp .env.example .env          # then fill in the keys
docker compose up -d          # local Postgres on port 5433 (+ a test database)
cd backend
uv sync                       # install dependencies
uv run alembic upgrade head   # create tables
uv run uvicorn app.main:app --reload --port 8000
```

API docs (OpenAPI) at http://localhost:8000/docs.

Frontend (in another terminal):

```bash
cd frontend
npm install
# frontend/.env.local: AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, BACKEND_JWT_SECRET
# (same value as the backend), NEXT_PUBLIC_BACKEND_URL=http://localhost:8000,
# and optionally AUTH_DEV_LOGIN=1 for a local sign-in without Google
npm run dev                   # http://localhost:3000
```

## Deploy

- **Backend (Railway):** `cd backend && railway up --service backend`. Builds `backend/Dockerfile` (migrates, then serves; no Chrome: the browser runs in Browser Use Cloud). Run **one replica**: tasks live in the process and are recovered from checkpoints after a restart. Env: `DATABASE_URL`, `BACKEND_JWT_SECRET`, `VAULT_MASTER_KEY`, `ANTHROPIC_API_KEY`, `BROWSER_USE_API_KEY`, `FRONTEND_URL`, `ENVIRONMENT=production`, optional `BROWSER_PROXY_SITES` (default `swiggy.com:in`) and `BROWSER_PROXY_COUNTRY` (all other sites). It refuses to start in production if one is missing.
- **Frontend (Vercel):** `cd frontend && vercel deploy --prod`. Env: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `BACKEND_JWT_SECRET` (same as the backend), `NEXT_PUBLIC_BACKEND_URL`. Never set `AUTH_DEV_LOGIN` there.
- **Google client:** add `https://<frontend>/api/auth/callback/google` as a redirect URI.

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
    executors/       orchestrator (Claude tool loop), browser agent (browser-use), fake
    llm.py           Claude client wrapper + cost tracking
    crypto.py        envelope encryption (AES-256-GCM)
    vault.py         credentials: store, list, revoke, browser placeholders
    browser_sessions.py  saved logins (encrypted cookies)
    live_login.py    log in yourself in a browser; cookies saved
    routes/          HTTP routes (docs/API.md)
    secret_scan.py   blocks secrets pasted into chat
  alembic/           migrations
  tests/
frontend/            Next.js 16 app: sign-in, chat, task cards, Connected accounts
  src/auth.ts        Auth.js (Google; dev-only email login)
  src/app/api/backend-token/  signs the 15-min backend JWT
  src/lib/api.ts     backend client + SSE stream with resume
  src/components/    ChatApp, TaskView, cards, AccountsView
docs/                plan, architecture, schema, API
```
