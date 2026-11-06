# Reliability test list

Manual end-to-end runs against the deployed app (real Claude, real browser). Run before the demo and after any risky change. Each row says what to do, what should happen, and what it proves.

Status: **first live run on 2026-11-05** (results below). Automated coverage of the same logic: 114 backend tests (`cd backend && uv run pytest`).

| # | Task | Expected | Proves |
|---|---|---|---|
| 1 | "How many stars does browser-use/browser-use have on GitHub?" | Correct number, a few browser steps, under $0.20 | Basic browser task, cost tracking |
| 2 | "Star the repo browser-use/browser-use" with nothing connected | Connect card for github.com; nothing done before access is given | Asks for access instead of guessing |
| 3 | Same task after logging in through the live view | Repo starred; reply confirms it from the page | Live-view login, cookies saved |
| 4 | A second GitHub task in a new chat | No login prompt; uses the saved session | Session reuse in a fresh browser |
| 5 | GitHub with a saved password + TOTP setup key (session removed first) | Logs in with 2FA without asking; codes never shown | Password + TOTP via placeholders |
| 6 | "Save my OpenRouter key, then ask a free model on OpenRouter to write a haiku" | Secure-input card → `call_api` to OpenRouter with a `:free` model → haiku; key shown only as a masked label | API key handling, API over browser, no secret in chat |
| 7 | Paste an API key into the chat box | Blocked with a "use the secure input" message; not stored | Secret detection in chat |
| 8 | Swiggy: "repeat my last order" (Indian proxy, automatic for swiggy.com) | OTP card → cart ready → Confirm card with item and total → stops before paying | SMS OTP, confirmation before irreversible steps |
| 9 | Reject the Confirm card in #8 | "Okay, I won't" and nothing ordered | User stays in control |
| 10 | Revoke Swiggy on the Vault page while #8 runs | Task stops with "You revoked access…"; next Swiggy task asks to connect again | Revocation stops running work |
| 11 | Leave an OTP or Confirm card unanswered for 10 min | Task fails with "I paused…"; **Resume** shows a fresh card and continues | Waiting timeout + resume from checkpoint |
| 12 | Restart the backend while a task is running | Task continues ("Hit a hiccup, picking up where I left off") | Crash recovery |
| 13 | Restart the backend right after approving an order | On recovery the site is checked read-only; the order is never placed twice | Idempotency markers |
| 14 | A task that loops (e.g. an impossible search) | Stops with a step, time or cost limit; **Start over** offered | Limits |
| 15 | Refresh the page mid-task, or open the chat on another device | Steps replay without gaps or duplicates; live updates continue | Event replay (SSE resume) |

## Results

| # | Result (2026-11-05, live site) | Notes |
|---|---|---|---|
| 1 | Pass | "About 120k"; GitHub API says 120,081. Steps streamed; live view showed in the chat. |
| 2 | Pass | Connect card before any action. |
| 3 | Pass after fix | First run crashed saving cookies (browser-use closed the browser first); fixed by reading cookies in the done callback. Resume then found the repo already starred and didn't click again. |
| 4 | Pass | New chat, no login prompt; "whoisasx, 20 starred" matches the GitHub API. |
| 5 | Skipped | Needs the GitHub 2FA setup key re-issued; placeholder + TOTP logic is covered by backend tests (`test_vault.py`). |
| 6 | Pass after change | The website chat needs a full account login, so the saved key was useless in the browser. Added `call_api`: haiku from a $0 OpenRouter model, $0 spent, key only shown masked. |
| 7 | Pass | Blocked with "That looks like a secret… It wasn't sent or saved"; logged. |
| 8 | Partial | Live-view login through the Indian proxy worked; order history and cart read correctly. Last item was out of stock; a replacement item run hit the $1 task limit before the Confirm card. |
| 9 | Not run | Needs #8 to reach the Confirm card. |
| 10 | Not run | |
| 11 | Pass | Unanswered question card failed after 10 min with "I paused because I needed your input"; Resume showed a fresh card and the task finished. (Also resumed fine after an Anthropic usage-limit error.) |
| 12 | Pass | `railway restart` mid browser step: "Hit a hiccup, picking up where I left off", the step re-ran and the answer matched the GitHub API. |
| 13 | Not run live | Needs a real irreversible action; covered by `test_interrupted_action_is_checked_not_repeated`. |
| 14 | Pass | The Swiggy run stopped with "This task hit its spending limit"; only Start over offered. |
| 15 | Pass | Reload mid-task: steps replayed without gaps or duplicates; live updates and the final reply continued. |

### Found during the run (fixed the same day unless noted)

- Connect card now offers both "Log in myself" (live view) and "Give my login details" (phone/email, optional password; the browser logs in and asks for codes on a card).
- After **Resume**, the chat now refreshes when the task ends; it also polls every 5 s while a task runs, in case the live stream drops.
- AI usage-limit and API-key errors now say so (`upstream_limit`) instead of "Something went wrong".
- Replies render Markdown (bold, lists, tables, links open in a new tab).
- Send shows the message right away with "Sending…".
- A browser's live view hides once that browser closes.
- Requests time out after 20 s with an error and a "Try again" button (chat and Vault) instead of loading forever.
- Follow-up tasks get a short note of the tools behind earlier replies, so they no longer falsely "correct" checked answers or re-ask answered questions.
- Not fixed: Swiggy runs are long (30+ steps) and can hit the $1 task limit.

## Vault check on localhost (Hachi Test Shop)

A fake website, served by the backend only when `ENVIRONMENT=development` ([app/testshop.py](../backend/app/testshop.py)), checks that every kind of saved access reaches a site correctly. No real accounts are needed.

1. Start the backend (`backend-visible` in `.claude/launch.json`, or `uv run uvicorn app.main:app --port 8000`) and the frontend.
2. Open http://testshop.localhost:8000/testshop/setup for the fake test values.
3. On the Vault page, save them for the site `testshop.localhost`: Credentials, 2FA authenticator key, API key, Payment card.
4. In a new chat:
   - *Use my saved API key to check which account I am on the Hachi Test Shop API* → `call_api` with the key added by the backend.
   - *Sign in to the Hachi Test Shop and buy the plush toy with my saved card* → password, a 2FA code generated from the setup key, a Confirm card, then checkout.
5. Open http://testshop.localhost:8000/testshop/log: each check (password, 2fa, api_key, card) shows pass or fail, with values masked.

Two dev-only exceptions make this work, both covered by `tests/test_testshop.py`: secrets may be typed on `http://` pages of this one site (everywhere else it's `https://` only), and `call_api` may call its API. In production the shop isn't mounted and neither exception applies.

Result (2026-11-06): the Vault page saved all four kinds, showed only masked labels (`hac…`, `Authenticator app`, `ts_te…8c0e`, `Card ••4242`), rejected a bad 2FA key and a card number that fails the checksum, logged each addition, and the database held no plain values.

Live agent run (2026-11-06, local, real Claude, visible Chrome): all four kinds passed on the shop's log. The API key check answered through `call_api`; the agent signed in with the password and a 2FA code, showed a Confirm card before paying, and the card checkout passed (order TS-651956, about $0.35 of AI use). The database had no secret values in tasks, events or messages afterwards. The run found four bugs, all fixed with tests in `tests/test_browser_output.py`:

- the browser model's report repeated the full card number: what leaves a browser step (progress lines, the final report, errors) is now scrubbed of saved values, card numbers also with spaces or dashes;
- browser-use's own step logs (Eval, Memory, Final Result) printed the card number to server logs: its loggers are now kept at WARNING;
- the second browser step started on `https://` for the http-only test site: steps now start from the site's right address;
- a site that didn't load was reported as "login required" and expired a good saved login: it's now `SITE_UNREACHABLE`, the login is kept, and the user is told to resume later.
