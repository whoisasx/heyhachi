# Project plan

A chat assistant that does tasks on real websites using a background cloud browser, and manages the user's access to those sites safely (passwords, 2FA, OTPs, API keys, saved sessions, revocation).

Status: all phases done and deployed at https://heyhachi.vercel.app. Left: the demo video.

---

## Step 1: Demo scenarios

Each scenario shows something the assignment grades (UX, credentials, reliability, judgment).

| # | Scenario | What it proves |
|---|---|---|
| 1 | **GitHub login with password + TOTP 2FA.** Run a second task afterwards: no login needed. | Credential vault, TOTP setup key given once through secure input, session reuse in a fresh browser |
| 2 | **"Log into my Gmail and use it to sign into Vercel."** The user logs into Gmail once through the live browser view; the agent then uses "Sign in with Google" on Vercel. | Live-view login (no password stored), cookie storage, cross-site login. This is the assignment's own sample prompt. |
| 3 | **"Save my OpenRouter API key, then ask a free model on OpenRouter to write a haiku."** The key is collected through a secure input; the agent then calls OpenRouter's API (`call_api`) and the backend adds the key, so it never appears in chat or model input. | API key handling; the agent picks the API over the browser |
| 4 | **"Repeat my last Swiggy order to the same address."** SMS OTP login, cart ready, confirm card, then stop before payment (or pay only on explicit confirmation). | SMS OTP flow, confirmation before irreversible actions, verifying the result |
| 5 | **Revoke Swiggy access**, then ask for a Swiggy task again: the assistant asks to connect. | Revocation |

### Open questions

- [x] Swiggy needs an Indian IP: Browser Use Cloud supports proxy country `in`. Set per site with `BROWSER_PROXY_SITES` (default `swiggy.com:in`), so other sites don't go through India.
- [x] OpenRouter: our account is on the free tier ($0 credit, 50 free-model requests a day). Free models are text only; image and video generation need paid credit, so scenario 3 uses a free text model. The website chat needs a full account login, so the agent uses the API through `call_api` instead (found in live testing).
- [ ] Test accounts ready: GitHub (with 2FA on), Gmail, Vercel, OpenRouter, Swiggy.

---

## Step 2: Accounts and API keys

Keys go in `.env` (git-ignored). See `.env.example` for the full list. Never paste keys into chat or commit them.

| Service | What it's for | Notes |
|---|---|---|
| Anthropic API | Orchestrator + browser agent LLM | Set a monthly spending limit |
| Browser Use Cloud | Cloud Chrome, live view, proxies | $5 minimum top-up; set `max_steps` per task |
| Google OAuth client | App sign-in (Auth.js) | Published (in production), so any Google account can sign in |
| Postgres | Database | Railway Postgres in production (Neon also works) |
| Railway (or Render/Fly) | Backend hosting | Must be a long-running server, not serverless |
| Vercel | Frontend hosting | |
| Vault master key | Encrypts stored secrets | Self-generated: `python -c "import secrets; print(secrets.token_hex(32))"` |

- [x] Anthropic key
- [x] Browser Use Cloud key
- [x] Google OAuth client ID + secret (client `browser-agent-local`, testing mode)
- [x] Database: Railway Postgres (instead of Neon)
- [x] Railway project
- [x] Vercel project
- [x] Vault master key generated (separate dev and production keys)

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
| 4.5 ✅ | **Frontend** (+ standalone live-login routes): Google sign-in, chat, cards (connect, secure input, OTP, confirm, retry), live view, Connected accounts page | All demo flows usable in the browser |
| 4.6 ✅ | **Reliability:** crash recovery, verification, confirmations, idempotency markers, step/time/cost limits | Killing the server mid-task recovers without losing the request or repeating an irreversible action |
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

**4.5 (done, except the Google client).** Next.js 16 app in `frontend/`: Auth.js sign-in (Google, plus a dev-only email login that production builds never enable), `/api/backend-token` signs the 15-min backend JWT, chat with a sidebar of conversations, a live task panel (steps, status, cards) fed by SSE with resume from the last event, cards for question, confirm, OTP, connect and secure input (secure input posts straight to `/vault/credentials` with `for_task`), and a Connected accounts page (list, remove, revoke, add access, "log in myself", recent activity). Backend: standalone live-login routes (`app/live_login.py`; dev opens a visible Chrome window, closed after 10 minutes). Next 16 notes: Cache Components is on, so pages read the session inside `<Suspense>` after `await connection()`; Middleware is now Proxy (not used).
Checked in the in-app browser against the real backend and Sonnet: dev sign-in → "save my OpenRouter key" → secure-input card → saved → task resumed and replied with only the masked label → key listed on Connected accounts with an audit entry; a key pasted into chat was blocked and not saved. Also fixed: duplicate steps from React's double-mount in dev (events are de-duplicated by seq).
Left: an embedded live view needs Browser Use Cloud (production).

**4.6 (done).** What was added:
- **Retry:** `POST /tasks/{id}/retry`. `resume` continues the same failed task from its checkpoint (the attempt counter starts over); `restart` moves the user's message to a new task. Limits (`step_limit`, `time_limit`, `cost_limit`) and `too_many_attempts` can only restart; `access_revoked` can't be retried. The task panel shows **Resume** / **Start over** buttons.
- **Time limit:** a watchdog fails a task after 10 minutes of *working* time (`time_limit`); time spent waiting for the user doesn't count. Counted per attempt.
- **Idempotency markers** (`tasks.markers`): an approved `confirm_action` writes `approved`; the next browser step on that site writes `started` before it acts and `done` after. If a crash (or failure) leaves a marker on `started`, the next browser step on that site does **not** run its instruction: it runs a read-only check of whether the action already happened, marks it `unknown`, and tells Claude to get a fresh approval before trying again. `restart` carries unfinished markers to the new task.
- **Fix:** the event stream now replays a resumed task's whole history (it used to stop at the first `failed`).
Checked by 10 new tests (78 in total), including "crash mid-order, resume: the order is checked, never placed twice", and in the browser with the fake executor: confirm card timed out → Resume → fresh card → done; a failing task → Start over → a new task.
Note: a normal (not irreversible) step that was in progress during a crash can run again; that's fine.
Already in place from earlier phases: crash recovery on startup (4.1), step and cost limits (4.2), confirmations (4.4), result checks by browser-use's judge (4.3).

**4.7 (done).** Done so far: `BROWSER_BACKEND=cloud` runs tasks and "log in myself" on Browser Use Cloud (live view URL shown in the chat, optional proxy country; India is supported, which settles the Swiggy question); backend `Dockerfile` (migrates, then serves; no Chrome inside; one replica only) checked locally; production refuses to start without its keys; frontend production build passes; [RELIABILITY.md](RELIABILITY.md) test list and [ACCESS.md](ACCESS.md) note written.
Deployed 2026-11-05: frontend on Vercel (first at browser-agent-drab.vercel.app, now https://heyhachi.vercel.app), backend on Railway with Railway Postgres (not Neon: one account fewer, private network), Browser Use Cloud browsers (checked: a cloud browser opened a page and returned a live view URL). Production secrets are new (not the dev ones) and live only in the hosts and the private notes file. The Google client has the production redirect URI.
Live test run done 2026-11-05 (results in [RELIABILITY.md](RELIABILITY.md)); Google sign-in works on the live site and the Google app is published.
After that: rebrand to **Hachi** with the domain https://heyhachi.vercel.app (the old URL still works and the backend accepts both), phone verification on the Profile page (Firebase Phone Auth), details for forms (encrypted, used as placeholders), a UX review ([UX-REVIEW.md](UX-REVIEW.md)) and its fixes, and Hachi the pet.

### Testing approach

- **Unit:** vault encryption/decryption, state transitions, event replay, idempotency markers.
- **Integration:** task runner with stubbed Claude and browser (no real API calls, runs in CI).
- **Live (manual, costs money):** the demo scenarios above, run before each milestone.

---

## Deliverables (from the assignment)

- [x] Runnable repo: https://github.com/whoisasx/heyhachi (setup in the README)
- [x] Deployed link: https://heyhachi.vercel.app
- [ ] ~2-minute demo video (script: [DEMO.md](DEMO.md))
- [x] Short note on access-management choices and known limits: [ACCESS.md](ACCESS.md)
