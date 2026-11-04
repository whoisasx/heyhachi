# Project plan

A chat assistant that does tasks on real websites using a background cloud browser, and manages the user's access to those sites safely (passwords, 2FA, OTPs, API keys, saved sessions, revocation).

Status: phases 4.1–4.4 done (backend skeleton, orchestrator, browser tool on local Chrome, vault). Next: 4.5 frontend.

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
| 4.2 ✅ | **Orchestrator:** Claude loop with tools (`run_browser_task`, `request_access`, `ask_user`, `list_connected_accounts`) | A message produces a plan and tool calls (browser tool stubbed) |
| 4.3 ✅ | **Browser tool:** browser-use (local Chrome in dev; Browser Use Cloud in production), saved sessions loaded and saved | A real task runs on a site and the session is reused in a fresh browser |
| 4.4 ✅ | **Vault:** envelope encryption, secure input, TOTP, SMS OTP pause/resume, revoke, audit log | Secrets never appear in chat, logs, or model input; revoke removes everything |
| 4.5 | **Frontend** (+ standalone live-login routes): Google sign-in, chat, cards (connect, secure input, OTP, confirm, retry), live view, Connected accounts page | All demo flows usable in the browser |
| 4.6 | **Reliability:** crash recovery, verification, confirmations, idempotency markers, step/time/cost limits | Killing the server mid-task recovers without losing the request or repeating an irreversible action |
| 4.7 | **Ship:** deploy, reliability test list (10–15 tasks), access-management note, demo video | Deployed link works for a reviewer |

### Phase notes

**4.1 (done).** All tables migrated; conversations, messages, task status, SSE (with replay), input, and cancel routes; runner with checkpoints, cards, timeouts, cancel, heartbeat and startup recovery; secret detection in chat. Runs a fake executor. Checked by 37 tests plus a manual run against a real server (live SSE, and `kill -9` mid-task followed by a successful recovery).
Not done yet, by design:
- `POST /tasks/{id}/retry`: phase 4.6
- OTP input and vault routes: done in 4.4

**4.2 (done).** Claude (`claude-sonnet-5-5`, effort medium) runs a manual tool loop in `app/executors/orchestrator.py`, saving a checkpoint after every step. On resume it re-runs any tool calls that have no results yet. Tools: `ask_user` (question card), `request_access` (connect or secure-input card; the form itself arrives in 4.4/4.5), `list_connected_accounts` (metadata only), and `run_browser_task` (an honest stub that says no browser is connected yet; 4.3 replaces it). Limits: 15 steps, $1 per task; refusals fail without retry. Prompt caching and server-side refusal fallback are on. Checked by 9 new tests with a scripted fake LLM (46 in total) and one live Sonnet run: "star a GitHub repo" produced a GitHub connect card for $0.0056.

**4.3 (done, local Chrome).** `run_browser_task` runs browser-use on Chrome on this machine (`app/executors/browser.py`). Each run gets a fresh, throwaway Chrome profile (deleted afterwards). The user's saved login for the site is decrypted and loaded, and refreshed cookies are saved back. If the agent finds it is logged out, it stops with `login_required` and the session is marked expired, so the orchestrator asks the user to connect. `request_access(browser_login)` opens a visible Chrome window where the user logs in themselves; when they confirm, the cookies are encrypted and saved (`source = live_login`). Step progress streams as progress events; browser-use's own judge checks the result; browser tokens count toward the task's $1 cap. Envelope encryption (`app/crypto.py`) and the session store were pulled forward from 4.4.
Choices made while testing live:
- The browser loop uses `claude-sonnet-5`, not 5.5. browser-use forces its output tool, and Sonnet 5.5 rejects forced tool choice. Workarounds (auto tool choice, then strict schemas) failed: malformed actions, then "grammar too large". Same price.
- browser-use's arbitrary-JavaScript action is disabled; its telemetry is off.
- anthropic SDK pinned to 1.x, because current browser-use requires `anthropic<2`.
Checked by 7 new tests (53 in total) and a live run: "how many stars does browser-use/browser-use have?" gave the correct answer in 3 browser steps with no errors, for $0.11 in total (about $0.025 per browser step).
Not verified live yet: the live-login window plus session reuse on a real account (needs the user to log in once).

**4.4 (done).** Vault routes (`GET /vault`, `POST /vault/credentials`, delete one, revoke a site, audit log) in `app/routes/vault.py`, logic in `app/vault.py`. Secrets are checked per kind (no CVV; TOTP keys must generate a code) and stored with envelope encryption; responses and errors only ever carry masked labels. Saving with `for_task` wakes the task waiting on that card. OTP input is encrypted with AAD `user|site|otp`, decrypted only inside the runner, and wiped once used. The browser gets secrets as `sensitive_data` placeholders scoped to `https://*.<site>`: the model sees names like `github.com_password`; browser-use types the real values and generates TOTP codes itself (`github.com_bu_2fa_code`). A browser action `ask_user_for_code` pauses for SMS/email codes. Revoking a site deletes its credentials and session and stops running tasks using it (`access_revoked`). New orchestrator tool `confirm_action` shows an Approve/Reject card before anything irreversible. Checked by 13 new tests (66 in total), including leak sweeps over every table, event, response, and the model's input.
Moved to 4.5: the standalone live-login routes (`/vault/live-login…`), because they only make sense with the Connected accounts page. Logging in inside a task already works through the `connect` card.
Not verified live yet: a real login with a saved password + TOTP, and an SMS code (needs the user's accounts).

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
