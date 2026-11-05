# Access management: choices and limits

A short note on how the assistant handles the user's access to websites, why, and what it doesn't do yet.

## Choices

**Ask for the least access that works.** The Connect card offers two ways: log in yourself in a live browser view (we keep only the resulting cookies, never the password), or give login details (phone number or email, password optional) so the browser logs in and asks for any SMS/email code on a card. Passwords, authenticator (TOTP) setup keys, API keys and cards are stored only when the user chooses to give them.

**Secrets never go through chat or the model.** They're typed into secure forms that post straight to the vault, never into chat history. The browser model sees placeholder names (`github.com_password`); browser-use swaps in the real value as it types, and generates TOTP codes itself. SMS codes are encrypted when they arrive, decrypted only inside the task runner, and deleted once used. Secrets pasted into chat are blocked and logged (without the value).

**Encrypted at rest, bound to their owner.** Envelope encryption: each secret has its own AES-256-GCM key, wrapped by a master key held only by the backend. The ciphertext is tied to user + site + kind, so it can't be moved to another user or site. The vault API is write-only: values go in, only masked labels come out.

**Secrets only work on their own site.** Placeholders are scoped to `https://*.<site>`, so a page on another domain can't get them typed in. Page content is treated as data, not instructions.

**The user stays in control.** Anything irreversible (pay, order, send, delete) needs an Approve card with the exact details. A crash around such an action never repeats it: the site is checked first, and the user approves again. Revoking a site deletes its credentials and session, stops running tasks using it, and is written to the audit log. Every use of a credential or session is logged.

**Fresh browser per task.** Each task gets a new browser (local Chrome in development, Browser Use Cloud in production) loaded with only that site's saved login, closed afterwards.

## Known limits

- **One master key in an env var.** No KMS or key rotation yet (`key_version` is stored for it).
- **Cookies are long-lived.** A saved session is as powerful as the user's login until it expires or is revoked. We mark it expired when a task finds itself logged out.
- **API keys are only sent to their own service.** `call_api` adds the key in the backend and only calls allowlisted API bases (OpenRouter today); any echo of the key in a response is scrubbed before the model sees it.
- **Placeholders hide values from the model, not from the browser.** A compromised site page could read a field after it's typed. Domain scoping reduces this.
- **Card payments** store the card without CVV, so sites that ask for CVV need the user. Paying in the demo stops before payment by default.
- **Bot checks and CAPTCHAs** aren't bypassed; the task stops and says so. Some sites need a proxy country; it's set per site (India for Swiggy only).
- **Single backend process.** Tasks live in one process; restarts are recovered from checkpoints, but scaling out needs a job queue.
- **No per-site permission scopes.** Access to a site is all-or-nothing; there's no "read-only" grant yet.
- **Google sign-in for the app is in testing mode**, so only listed test users can sign in.
