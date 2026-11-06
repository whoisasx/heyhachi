# Demo video script (~2 minutes)

Record on the live site (https://heyhachi.vercel.app). Before recording:

- Vault: remove GitHub and OpenRouter, so the connect flows show. Remove vercel.com but keep google.com, so scene 5b shows the "Sign in with Google" card.
- GitHub: if you already starred whoisasx/heyhachi, unstar it so scene 2 has something to do.
- Have a GitHub account and your OpenRouter key at hand (copy the key from a password manager, not from a file on screen).
- Swiggy (scene 5) only if an SMS-capable phone is next to you; otherwise skip it.
- Run each scene once off camera first: the first cloud browser can take ~10 s to start.
- Speed up long browser waits 2–4× in editing; keep cards and replies at normal speed.

| Time | Scene | Do | Say (voice-over) |
|---|---|---|---|
| 0:00–0:10 | **Intro** | Show the sign-in page, sign in with Google. | "This is Hachi: a chat assistant that does things on websites in a real browser, and keeps your logins, codes and keys out of the chat." |
| 0:10–0:30 | **1. Simple browser task** | Type: *How many stars does whoisasx/heyhachi have on GitHub?* The task header shows the current step (click it to unfold all steps), then click **Watch** once to open the live browser, and close it. | "The browser runs in the background: I just get short updates. If I'm curious I can watch it live. Cost and steps are tracked." |
| 0:30–0:55 | **2. Asks for access, user logs in** | Type: *Star the repo whoisasx/heyhachi.* A **Connect github.com** card appears → choose **Log in myself** → log in inside the live view → task continues and stars the repo. | "It doesn't guess or ask for my password in chat. I log in myself in the live view; only the session cookies are saved, encrypted." |
| 0:55–1:05 | **3. Session reuse** | New chat: *What's my most recent GitHub notification?* No login prompt. | "A fresh browser, but it reuses the saved session." |
| 1:05–1:25 | **4. API key, never in chat** | Paste a fake key like `sk-or-v1-test…` in the chat box → blocked. Then type: *Save my OpenRouter API key, then ask a free model on OpenRouter to write a haiku about browsers.* A **secure input** card appears → paste the real key there → reply shows only the masked label. | "Secrets typed into chat are blocked. Keys go through a secure form straight to the vault; the model only sees a placeholder." |
| 1:25–1:40 | **5. Confirm before irreversible steps** *(optional: Swiggy)* | *Repeat my last Swiggy order.* OTP card → enter the SMS code → **Confirm** card with items and total → **Reject**. | "SMS codes go through a card too, and anything irreversible needs my explicit approval. Swiggy runs through an Indian proxy automatically." |
| 1:25–1:40 | **5b. Sign in with Google** *(if Swiggy is skipped)* | *Sign in to vercel.com with my Google account and list my projects. Don't change anything.* A **Sign in to vercel.com with Google?** card → **Approve** → project list. Open the Vault: vercel.com and google.com are separate logins. | "My Google login is powerful, so Hachi asks before using it on another site, and Vercel gets its own login without copying Google's." |
| 1:40–1:55 | **6. Control and audit** | Open **Vault**: show GitHub and OpenRouter with masked labels and the audit log → **Revoke** GitHub. | "Everything is listed and logged, and revoking deletes the credentials and stops any task using them." |
| 1:55–2:05 | **7. Reliability (quick)** | Show a failed task with **Resume** / **Start over**, click Resume. | "Tasks are checkpointed: they resume after crashes or timeouts, and an approved action is never repeated." |
| 2:05–2:10 | **Outro** | Back to the chat. | "Repo and docs are linked in the description." |

If scene 5 is skipped, use scene 5b (Sign in with Google) in its place.
