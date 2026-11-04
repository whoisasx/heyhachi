# Browser Agent

A chat assistant that does tasks on real websites using a background cloud browser, and manages access to those sites safely: passwords, TOTP 2FA, SMS OTPs, API keys, saved sessions, and revocation. Secrets never appear in chat or model input.

Status: planning complete, build in progress.

- [Plan](docs/PLAN.md): demo scenarios, keys, build phases
- [Architecture](docs/ARCHITECTURE.md): components, task lifecycle, data model, crash recovery, secrets
- [Schema](docs/SCHEMA.md): database tables, JSON shapes, event types
- [API](docs/API.md): HTTP routes, SSE stream, auth, errors

## Stack

Next.js + Auth.js (Google) on Vercel · FastAPI (Python) on Railway · Postgres (Neon) · Claude API · browser-use on Browser Use Cloud

## Setup

```bash
cp .env.example .env   # then fill in the keys
```
