# Reliability test list

Manual end-to-end runs against the deployed app (real Claude, real browser). Run before the demo and after any risky change. Each row says what to do, what should happen, and what it proves.

Status: **not run on the deployed app yet.** Automated coverage of the same logic: 79 backend tests (`cd backend && uv run pytest`).

| # | Task | Expected | Proves |
|---|---|---|---|
| 1 | "How many stars does browser-use/browser-use have on GitHub?" | Correct number, a few browser steps, under $0.20 | Basic browser task, cost tracking |
| 2 | "Star the repo browser-use/browser-use" with nothing connected | Connect card for github.com; nothing done before access is given | Asks for access instead of guessing |
| 3 | Same task after logging in through the live view | Repo starred; reply confirms it from the page | Live-view login, cookies saved |
| 4 | A second GitHub task in a new chat | No login prompt; uses the saved session | Session reuse in a fresh browser |
| 5 | GitHub with a saved password + TOTP setup key (session removed first) | Logs in with 2FA without asking; codes never shown | Password + TOTP via placeholders |
| 6 | "Save my OpenRouter key, then ask a free model on OpenRouter to write a haiku" | Secure-input card; reply shows only the masked label | API key handling, no secret in chat |
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

| Date | Build | Passed | Notes |
|---|---|---|---|
| | | | |
