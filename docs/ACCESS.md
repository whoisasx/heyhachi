# Access management: choices and limits

A short note on how the assistant handles the user's access to websites, why, and what it doesn't do yet.

## Choices

**Ask for the least access that works.** The Connect card offers two ways: log in yourself in a live browser view (we keep only the resulting cookies, never the password), or give login details (phone number or email, password optional) so the browser logs in and asks for any SMS/email code on a card. Passwords, authenticator (TOTP) setup keys, API keys and cards are stored only when the user chooses to give them.

**Secrets never go through chat or the model.** They're typed into secure forms that post straight to the vault, never into chat history. The browser model sees placeholder names (`github.com_password`); browser-use swaps in the real value as it types, and generates TOTP codes itself. SMS codes are encrypted when they arrive, decrypted only inside the task runner, and deleted once used. Secrets pasted into chat are blocked and logged (without the value).

**Encrypted at rest, bound to their owner.** Envelope encryption: each secret has its own AES-256-GCM key, wrapped by a master key held only by the backend. The ciphertext is tied to user + site + kind, so it can't be moved to another user or site. The vault API is write-only: values go in, only masked labels come out.

**Secrets only work on their own site.** Placeholders are scoped to `https://*.<site>`, so a page on another domain can't get them typed in. Page content is treated as data, not instructions.

**The user stays in control.** Anything irreversible (pay, order, send, delete) needs an Approve card with the exact details. A crash around such an action never repeats it: the site is checked first, and the user approves again. Revoking a site deletes its credentials and session, stops running tasks using it, and is written to the audit log. Every use of a credential or session is logged.

**Personal details are placeholders too.** The phone number is verified with Firebase (Google sends the SMS); the backend checks the token and keeps only the encrypted number. Details for forms (name, birthday, email, address) are typed into the task's site as placeholders the model never sees; only the ones it has to pick from a list (city, state, country, gender, food preference) are shown to it.

**Each saved login holds only its own site.** A browser picks up other sites' cookies during a task (trackers, a Google sign-in page); only the site's own cookies and storage are saved under it, so the Vault shows exactly what's held and revoking a site removes all of it.

**"Sign in with Google" only on approval.** If the user connected google.com, a task on another site that offers Google sign-in shows a card first ("Sign in to vercel.com with Google?"). Only after Approve is the Google login loaded into that task's browser; afterwards the site's new login is saved under the site and Google's refreshed cookies under google.com. Revoking Google stops a task using it.

**Fresh browser per task.** Each task gets a new browser (local Chrome in development, Browser Use Cloud in production) loaded with only that site's saved login, closed afterwards.

## Known limits

- **One master key in an env var.** No KMS or key rotation yet (`key_version` is stored for it).
- **Cookies are long-lived.** A saved session is as powerful as the user's login until it expires or is revoked. We mark it expired when a task finds itself logged out.
- **API keys are only sent to their own service.** `call_api` adds the key in the backend and only calls allowlisted API bases (OpenRouter today); any echo of the key in a response is scrubbed before the model sees it.
- **Placeholders hide values from the model, not from the browser.** A compromised site page could read a field after it's typed. Domain scoping reduces this.
- **After typing, the browser model can see the value on the page.** A filled card or name field shows in the page text and screenshots it gets on the next step (password fields are masked by the site). So everything that leaves a browser step (progress, final report, errors) is scrubbed of saved values before it's stored or shown, and browser-use's step logs are turned off on the server.
- **The site is checked in code, the field isn't.** A placeholder only turns into the real value on the saved site (checked against the page URL), but which box it goes into is the model's choice, guided by instructions. On the right site it could still type a password into a search or comment box, or put a placeholder in a URL, and the check uses the page's address, not an embedded frame's. **Next:** a "fill field with saved secret" action that inspects the element first (password only into `type=password`, card number only into `cc-number`, codes into one-time-code fields), checks the field's own frame is on the site, and allows secrets in no other action; if a field can't be matched, it asks the user.
- **Card payments** store the card without CVV, so sites that ask for CVV need the user. Paying in the demo stops before payment by default.
- **Bot checks and CAPTCHAs** aren't bypassed; the task stops and says so. Some sites need a proxy country; it's set per site (India for Swiggy only).
- **A Google login is powerful.** It can reset passwords elsewhere, and Google may challenge or end a session that shows up in a cloud browser, so it may need logging in again. It's never used without a per-task approval.
- **Single backend process.** Tasks live in one process; restarts are recovered from checkpoints, but scaling out needs a job queue.
- **No per-site permission scopes.** Access to a site is all-or-nothing; there's no "read-only" grant yet.
- **Google sign-in to Hachi asks only for name and email.** The app is published; asking for more (e.g. Gmail access) would need Google's review.
