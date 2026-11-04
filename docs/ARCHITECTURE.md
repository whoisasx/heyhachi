# Architecture

Decisions made during planning, so the build follows one design.

## Overview

```
Web app (Next.js on Vercel)  ──HTTP + SSE──▶  FastAPI backend (one process, Railway)
   chat, cards, live view                       ├─ API routes
        ▲                                       ├─ Task runner   (one async task per request)
        │ live browser view (direct)            ├─ In-memory relay (task_id → SSE streams)
        │                                       └─ Vault         (encrypt / decrypt secrets)
Browser Use Cloud  ◀──CDP──  task runner  ──HTTP──▶  Claude API
   └─▶ target websites                     ──SQL──▶  Postgres (Neon)
```

## Components

**Web app (Next.js, Auth.js, Tailwind, Vercel).** Google sign-in for the app only. Chat with special cards: Connect account, Secure input, OTP, Confirm action, Retry. Embedded live browser view. Connected accounts page with revoke. Holds no secrets and no business logic.

**FastAPI backend (Python ≥ 3.11).** One process, one asyncio event loop.

- **API routes** (fast, never do slow work):
  - `POST /messages`: save message, create task, start `run_task` in the background, return `task_id`
  - `GET /tasks/{id}/events`: SSE stream; replays saved events after `Last-Event-ID`, then live
  - `POST /tasks/{id}/input`: OTP, confirmation, or credential for a waiting task
  - `POST /vault`, `GET /vault` (metadata only), `DELETE /vault/{id}`
- **Task runner:** `asyncio.create_task(run_task(task_id))` per request, kept in a registry so it can be cancelled and isn't garbage-collected. All code inside is async (no blocking calls).
  1. Orchestrator loop: Claude (Anthropic SDK) with tools `run_browser_task`, `request_access`, `ask_user`, `list_connected_accounts`
  2. Browser agent: browser-use on Browser Use Cloud, secrets passed as placeholders via `sensitive_data`
  3. Verify the result, save refreshed cookies, reply
- **In-memory relay:** dict of `task_id → open SSE connections`. Works because v1 is a single process.
- **Vault:** the only code that encrypts/decrypts. Provides browser-use tools `fill_totp` and `ask_user_for_code`.

**Postgres (Neon).** All durable state. **Browser Use Cloud.** Chrome containers, live view URL, proxies. **Claude API.** Both LLM loops.

## Task lifecycle

States: `queued → running ⇄ waiting_user → verifying → done`, plus `failed` and `cancelled`. A worker crash sends `running` back to `queued`.

| Status | Meaning |
|---|---|
| `queued` | Waiting to be picked up |
| `running` | Actively running; heartbeats every 10s |
| `waiting_user` | Paused for OTP / confirmation / credential (`waiting_for` says which); browser kept alive, times out after 10 min |
| `verifying` | Checking the result really happened |
| `done` / `failed` / `cancelled` | Finished |

Status is coarse on purpose (just enough for recovery). Fine-grained progress goes in events.

## Data model

- `users`, `conversations`, `messages`
- `tasks`: `id, user_id, status, waiting_for, checkpoint (Claude message history + in-flight step), browser_session_id, worker_id, heartbeat_at, attempt, markers (irreversible actions), result, error, created_at, updated_at`
- `task_events`: `task_id, seq, type, payload, created_at` (append-only; the chat is these events rendered in order)
- `task_inputs`: `task_id, kind, value (encrypted), consumed_at`
- `credentials`: `user_id, site, kind, label, ciphertext, nonce, encrypted_dek, dek_nonce, key_version, created_at, last_used_at`
- `sessions`: same encryption fields + `status (active|expired), updated_at` (cookies + localStorage)
- `audit_log`: `user_id, credential_id, action, task_id, at`

Large blobs (screenshots, recordings) go to object storage, never Postgres.

## Rules for state

1. Every state change is one transaction: update `tasks` and insert the `task_events` row together.
2. Push to the relay only after the commit. If the push is lost, the client catches up from `task_events`.
3. Every write checks ownership (`WHERE id = ? AND worker_id = ?`), so a stale worker can't overwrite a task that was taken over.
4. Irreversible actions (send, order, submit) record a marker before and after. On recovery, check the site before retrying, never repeat blindly.

## Crash recovery

| Case | Handling |
|---|---|
| Process dies while `running` | On startup (v1) or stale heartbeat (v2): if `attempt < 3` re-queue, else `failed` with Retry. Resume from `checkpoint`; reconnect to the browser session or start a fresh one with saved cookies; tell the agent to check the current page first. |
| Dies around an irreversible action | `attempt_started` set but no `done` marker: check the site (e.g. order history) before doing anything. |
| Dies while `waiting_user` | Nothing lost. When input arrives the task resumes; if the browser expired, log in again and ask for a fresh OTP. |
| User never answers | After timeout: `failed` (`waiting_timeout`), checkpoint kept, Resume button. |
| Claude / Browser Use errors | Retry inside the step with backoff; then `failed` with a clear message. |
| User refreshes or closes the tab | Task keeps running; reconnect replays events after the last seen `seq`. |

Every task has limits on browser steps, wall time, and cost.

## Secrets

- Envelope encryption: AES-256-GCM, a fresh data key per secret, encrypted by a master key (env var in v1, KMS later). AAD = `user_id|site|kind`.
- The vault API is write-only: secrets go in, only metadata comes out.
- Decrypt just in time, inside the task runner only. Claude only ever sees placeholders.
- Two ways to connect a site: log in yourself through the live view (we store cookies, not the password), or give credentials through a secure form (password, TOTP setup key, API key, card without CVV).
- Keep secrets out of chat (detect pasted secrets), logs, screenshots on sensitive steps, and browser-use history files.
- Revoke deletes credentials and sessions and writes to the audit log.

## Scaling path (not built in v1)

1. **v1 (now):** one process, in-memory relay. Tens of concurrent tasks.
2. **v2:** separate API and worker processes; Postgres queue (`FOR UPDATE SKIP LOCKED`) or SQS/Redis Streams for delivery with Postgres for state; Redis pub/sub relay; batched heartbeats.
3. **v3:** durable workflow engine (Temporal/Inngest), KMS, per-user rate limits, self-hosted browser fleet if cost requires.

Known v1 limits: single instance only (in-memory relay), redeploys interrupt running tasks (handled by recovery), master key in an env var.
