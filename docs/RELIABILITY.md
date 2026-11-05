# Reliability test list

Manual end-to-end runs against the deployed app (real Claude, real browser). Run before the demo and after any risky change. Each row says what to do, what should happen, and what it proves.

Status: **first live run on 2026-11-05** (results below). Automated coverage of the same logic: 83 backend tests (`cd backend && uv run pytest`).

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
| 10 | Revoke Swiggy on Connected accounts while #8 runs | Task stops with "You revoked access…"; next Swiggy task asks to connect again | Revocation stops running work |
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
| 5 | Not run | |
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

### Found during the run, to fix

- Connect card should offer both "Log in myself" and "give my phone number" (agent logs in, SMS code via card), not only live-view login.
- After **Resume**, the final reply only appeared after a page reload.
- Upstream errors (e.g. Anthropic usage limit) show as "Something went wrong"; they should say what happened and not offer Resume until it's fixed.
- Replies show raw `**` (no Markdown rendering).
- No feedback for a few seconds after Send.
- A finished browser's live view box stays, showing "Waiting for the browser connection…".
- Connected accounts page stuck on "Loading…" after one network error (no retry or message).
- Follow-up tasks wrongly "correct" earlier answers ("I didn't read that from the page") and repeat old questions: the history passed to a new task has the replies but no record of the tool calls behind them.
- The browser pane sometimes stalled requests to the app (`/api/backend-token` pending, `ERR_CONNECTION_RESET`); a new tab fixed it. Likely the pane, but the app should time out and show an error instead of an empty page.
- Swiggy runs are long (30+ steps): menu navigation is slow; the $1 task limit is tight for food ordering.
