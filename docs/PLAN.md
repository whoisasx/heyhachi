# Project plan

A chat assistant that does tasks on real websites using a background cloud browser, and manages the user's access to those sites safely (passwords, 2FA, OTPs, API keys, saved sessions, revocation).

Status: phase 4.1 done (backend skeleton). Next: 4.2 orchestrator.

---

## Step 1: Demo scenarios

Each scenario shows something the assignment grades (UX, credentials, reliability, judgment).

| # | Scenario | What it proves |
|---|---|---|
| 1 | **GitHub login with password + TOTP 2FA.** Run a second task afterwards: no login needed. | Credential vault, TOTP setup key given once through secure input, session reuse in a fresh browser |
| 2 | **"Log into my Gmail and use it to sign into Vercel."** The user logs into Gmail once through the live browser view; the agent then uses "Sign in with Google" on Vercel. | Live-view login (no password stored), cookie storage, cross-site login. This is the assignment's own sample prompt. |
| 3 | **"Use my OpenRouter API key to generate a video."** The key is collected through a secure input and never appears in chat or model input. | API key handling; the agent picks an API over the browser when that's the better tool |
| 4 | **"Repeat my last Swiggy order to the same address."** SMS OTP login, cart ready, confirm card, then stop before payment (or pay only on explicit confirmation). | SMS OTP flow, confirmation before irreversible actions, verifying the result |
| 5 | **Revoke Swiggy access**, then ask for a Swiggy task again: the assistant asks to connect. | Revocation |

### Open questions

- [ ] Swiggy needs an Indian IP. Check Browser Use Cloud's proxy country setting.
- [ ] Check what OpenRouter actually supports for video generation. Fall back to image generation or another API-key task if needed.
- [ ] Test accounts ready: GitHub (with 2FA on), Gmail, Vercel, OpenRouter, Swiggy.

---

## Step 2: Accounts and API keys

Keys go in `.env` (git-ignored). See `.env.example` for the full list. Never paste keys into chat or commit them.

| Service | What it's for | Notes |
|---|---|---|
| Anthropic API | Orchestrator + browser agent LLM | Set a monthly spending limit |
| Browser Use Cloud | Cloud Chrome, live view, proxies | $5 minimum top-up; set `max_steps` per task |
| Google OAuth client | App sign-in (Auth.js) | Consent screen in testing mode only allows added test users |
| Neon Postgres | Database | Free tier is enough |
| Railway (or Render/Fly) | Backend hosting | Must be a long-running server, not serverless |
| Vercel | Frontend hosting | |
| Vault master key | Encrypts stored secrets | Self-generated: `python -c "import secrets; print(secrets.token_hex(32))"` |

- [ ] Anthropic key
- [ ] Browser Use Cloud key
- [ ] Google OAuth client ID + secret
- [ ] Neon database URL
- [ ] Railway project
- [ ] Vercel project
- [ ] Vault master key generated

---

## Step 3: Risk spike (deferred)

A throwaway script to prove the risky parts before building the app. Skipped for now; we will cover these as we build step 4.3, but each must be confirmed early.

1. Start a Browser Use Cloud browser and get the live view URL.
2. Log into a site manually through the live view.
3. Export cookies + localStorage, close the browser, start a fresh one, import them, confirm still logged in.
4. Run one browser-use task with a `sensitive_data` placeholder and confirm the model never sees the real value.

---

## Step 4: Build phases

Tests are written alongside each phase, not at the end.

| Phase | What | Done when |
|---|---|---|
| 4.1 ✅ | **Backend skeleton:** FastAPI, Postgres tables, task runner with states + events, SSE stream | A fake task moves through states and the events stream to a client; refresh replays missed events |
| 4.2 | **Orchestrator:** Claude loop with tools (`run_browser_task`, `request_access`, `ask_user`, `list_connected_accounts`) | A message produces a plan and tool calls (browser tool stubbed) |
| 4.3 | **Browser tool:** browser-use on Browser Use Cloud, saved sessions loaded and saved | A real task runs on a site and the session is reused in a fresh browser |
| 4.4 | **Vault:** envelope encryption, secure input, TOTP, SMS OTP pause/resume, revoke, audit log | Secrets never appear in chat, logs, or model input; revoke removes everything |
| 4.5 | **Frontend:** Google sign-in, chat, cards (connect, secure input, OTP, confirm, retry), live view, Connected accounts page | All demo flows usable in the browser |
| 4.6 | **Reliability:** crash recovery, verification, confirmations, idempotency markers, step/time/cost limits | Killing the server mid-task recovers without losing the request or repeating an irreversible action |
| 4.7 | **Ship:** deploy, reliability test list (10–15 tasks), access-management note, demo video | Deployed link works for a reviewer |

### Phase notes

**4.1 (done).** All tables migrated; conversations, messages, task status, SSE (with replay), input, and cancel routes; runner with checkpoints, cards, timeouts, cancel, heartbeat and startup recovery; secret detection in chat. Runs a fake executor. Checked by 37 tests plus a manual run against a real server (live SSE, and `kill -9` mid-task followed by a successful recovery).
Not done yet, by design:
- `POST /tasks/{id}/retry`: phase 4.6
- OTP input (`kind: otp`) returns 422 until the vault encrypts it: phase 4.4
- Vault routes: phase 4.4

Note: a step that was in progress during a crash can run again (e.g. a progress line shows twice). That's fine for normal steps; irreversible steps get idempotency markers in 4.6.

### Testing approach

- **Unit:** vault encryption/decryption, state transitions, event replay, idempotency markers.
- **Integration:** task runner with stubbed Claude and browser (no real API calls, runs in CI).
- **Live (manual, costs money):** the demo scenarios above, run before each milestone.

---

## Deliverables (from the assignment)

- [ ] Runnable repo
- [ ] Deployed link
- [ ] ~2-minute demo video
- [ ] Short note on access-management choices and known limits
