# Hachi, the loyal agent

A chat assistant that does tasks on real websites using a background cloud browser, and manages access to those sites safely: passwords, TOTP 2FA, SMS OTPs, API keys, saved sessions, and revocation. Secrets never appear in chat or model input.

**Live:** https://heyhachi.vercel.app (sign in with Google).

Status: built, deployed and tested live (see [RELIABILITY.md](docs/RELIABILITY.md)). The access-management note is [ACCESS.md](docs/ACCESS.md).

## What it does

- **Chat:** ask in plain language; Hachi asks only for what it needs, runs a cloud browser in the background, streams short step updates, and shows a live view you can open if you want to watch. Every task shows its steps, time and cost.
- **Connect once:** when a site needs access, a card offers "Log in myself" (a live browser view; only the cookies are kept) or "Give my login details" (password and optional TOTP setup key through a secure form). SMS/email codes come in on a card. API keys go through the same secure form and are used by the backend, never shown to the model.
- **Confirm before anything irreversible:** orders, payments, sending and deleting need an Approve card with the exact details.
- **Recover, don't restart:** tasks are checkpointed. After a crash, timeout or expired login they resume where they stopped, and an approved action is never repeated.
- **Vault:** every saved login, key, card and session, with masked labels, remove or revoke per site, and an audit log of every use.
- **Profile:** a verified phone number (Firebase) and optional details for forms (name, address, ...), typed into sites as placeholders the model never sees.
- **Hachi** the golden retriever sits on the chat box and can roam the page (Settings has the themes).

## Docs

- [Plan](docs/PLAN.md): demo scenarios, keys, build phases, deliverables
- [Architecture](docs/ARCHITECTURE.md): components, task lifecycle, data model, crash recovery, secrets
- [Schema](docs/SCHEMA.md): database tables, JSON shapes, event types
- [API](docs/API.md): HTTP routes, SSE stream, auth, errors
- [Access management](docs/ACCESS.md): choices and known limits
- [Reliability test list](docs/RELIABILITY.md): manual end-to-end checks and results
- [Demo script](docs/DEMO.md): the ~2-minute recording

## Stack

Next.js 16 + Auth.js (Google) on Vercel · FastAPI (Python) on Railway · Postgres (Railway) · Claude API (Sonnet) · Firebase Phone Auth · browser-use on Browser Use Cloud

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

- **Backend (Railway):** `cd backend && railway up --service backend`. Builds `backend/Dockerfile` (migrates, then serves; no Chrome: the browser runs in Browser Use Cloud). Run **one replica**: tasks live in the process and are recovered from checkpoints after a restart. Env: `DATABASE_URL`, `BACKEND_JWT_SECRET`, `VAULT_MASTER_KEY`, `ANTHROPIC_API_KEY`, `BROWSER_USE_API_KEY`, `FRONTEND_URL`, `ENVIRONMENT=production`, `FIREBASE_PROJECT_ID` (phone verification; off if unset), optional `BROWSER_PROXY_SITES` (default `swiggy.com:in`) and `BROWSER_PROXY_COUNTRY` (all other sites). It refuses to start in production if one is missing.
- **Frontend (Vercel):** `cd frontend && vercel deploy --prod`. Env: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `BACKEND_JWT_SECRET` (same as the backend), `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_FIREBASE_API_KEY` / `_AUTH_DOMAIN` / `_PROJECT_ID` / `_APP_ID` (public web config). Never set `AUTH_DEV_LOGIN` or `NEXT_PUBLIC_FIREBASE_TEST_PHONES` there.
- **Google client:** add `https://<frontend>/api/auth/callback/google` as a redirect URI.

## Tests

```bash
cd backend
uv run pytest                 # 114 tests; needs `docker compose up -d`
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
    phone.py         verified phone number (Firebase ID token check)
    profile.py       details for forms, encrypted, used as placeholders
  alembic/           migrations
  tests/
frontend/            Next.js 16 app: sign-in, chat, task cards, Vault, Profile, Settings
  src/auth.ts        Auth.js (Google; dev-only email login)
  src/app/api/backend-token/  signs the 15-min backend JWT
  src/lib/api.ts     backend client + SSE stream with resume
  src/components/    ChatApp, TaskView, cards, AccountsView (Vault), ProfileDetails, Pet (Hachi)
  scripts/pet.py     draws Hachi's SVG poses into public/pet/
docs/                plan, architecture, schema, API, access note, reliability, demo
```
