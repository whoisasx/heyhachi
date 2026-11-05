# UX review — 6 viewpoints (Nov 2026)

Six reviewers used the local app (mock backend) at the same time: first-time visitor, power user,
visual designer, accessibility (keyboard + screen reader), phone user, privacy-minded user.
Items several reviewers raised independently are marked with how many (×N).

Note: the "You already have tasks running" error, theme flipping and some empty chats were partly
caused by six reviewers sharing one account at once. The *handling* of that error is still a real bug.

## P0 — fix first

1. **No Stop button** (×3). The chat box is locked while a task runs and nothing can halt it.
   Backend already has cancel (`routes/tasks.py`). Add a Stop button in place of Send (and on the
   live view). Let the user type the next message while waiting.
2. **New card appears off-screen** (×3). "Needs you" cards land below the fold with no scroll or
   pointer. Auto-scroll to the new card (unless the user scrolled up), else a sticky
   "Needs your answer ↓" pill. Tab title "(1) Needs you · Hachi"; amber dot on the chat in the sidebar.
3. **Confirm card says nothing useful** (×3). It repeats the user's whole prompt. Show site, action,
   amount, budget left; buttons "Approve" / "Don't do it"; say what happens on reject.
4. **"Tasks running" error** (×4). Doesn't say which task, "Try again" doesn't resend, and every
   rejected send leaves an empty "New chat" in the sidebar. → "A task is still running: <name> [Open] [Stop]";
   create the chat only when a message is accepted; hide/delete empty chats.
5. **Focus and screen reader** (a11y). Focus drops to `<body>` after send and after answering a
   card; no live regions for status/cards/replies; no skip link; no `:focus-visible` style.
   → focus new card's first field, return focus to composer; `role="log"` on messages,
   `role="status"` on the state chip, `role="alert"` on errors; global
   `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`.
6. **iOS zooms on the chat box** (phone). Composer text is ~13px; inputs need 16px on phones.

## P1 — next

7. **Answered cards vanish** (×3). Keep a one-line record: "Size → Medium", "Approved ✓ 3:29".
8. **Failure state** (×2). "Something went wrong" with no reason; Resume repeats the same failure;
   old failed cards keep live buttons. Give cause + next step; disable stale cards.
9. **Show cost per task** (privacy). Footer on done tasks: "Cost $0.004 · 4 steps · 38s"; live cost
   chip while working. "Avg time 86m 12s" in Settings looks wrong — check it.
10. **Live view** (×3). Add a header (site domain, "Hachi is browsing", Stop). On phones it's a tiny
    crop: reuse the Vault's Expand/Close for the in-chat live view. Collapse it when a card shows below.
11. **Login card wording** (×2). "A browser window opened on the computer running the agent" — local
    wording. Cloud: "Sign in in the browser above, then tap Done. Hachi never sees what you type."
    Say the login is remembered in the Vault ("remove anytime", "used only on swiggy.com").
12. **Code card copy**: "Goes straight to the vault" is wrong for a one-time code →
    "Used once for swiggy.com, then deleted."
13. **Sidebar**: chat titles cut mid-word (add tooltip / better auto-title), group Today/Yesterday,
    search, rename/delete unreachable on touch (hover-only, 23px) → "…" menu.
14. **Keyboard**: autofocus composer on load / New chat / task end; "/" to focus; Cmd+K search chats.
15. **Pet in the way** (×4). Covers card buttons, error bar, "Try again" on phones. Keep it out of the
    card column (hide or move while a card is open; smaller on phones).
16. **Touch targets** (phone + a11y): copy/rename/delete 23px, Sign out 23px, hamburger 30px,
    Approve/Reject 36px → ≥44px on touch (`@media (pointer: coarse)`).

## P2 — polish

17. **Page headers inconsistent**: Vault has no H1, Profile H1 = H2 size, heavy rules in light mode →
    one `PageHeader` + one section label style.
18. **Reply tables**: tiny (~11px) with heavy black borders in light → full width, 13px, horizontal
    hairlines, muted header. Reply text a bit larger (14.5px / 1.6).
19. **Duplicate links**: "[Open the repo](url)" followed by a card for the same URL → dedupe.
20. **Cards look uneven**: mixed "?"/"S"/"!" tiles; "Send"/"Submit code" look disabled when they're not;
    lock emoji with no gap. One tile style, clear primary button.
21. **Light theme**: muted text 4.29:1 (needs 4.5) → darken `--muted` to ~#6B675F; soften chart blue;
    tiny shadow on cards.
22. **Settings**: Theme subtext stale ("System follows…" after picking Light); limits read-only with
    no explanation; "Coming soon" pill too loud; loading shows bare skeletons for 10s.
23. **Vault**: "Loading…" text and bare "No activity yet" → skeleton + friendly empty state; Remove asks
    to confirm; "Last used" per login. Profile says phone "Not added" while Vault shows "Phone verified".
24. **Phone layout**: hide the avatar gutter so cards are full width; sticky top bar on Vault/Profile/
    Settings (hamburger overlaps headings); collapse sidebar under ~900px on tablet.
25. **Per-page `<title>`**; sign-in demo `aria-hidden`; Terms/Privacy real links; empty chat:
    more varied examples and a sub-line "An AI agent that uses a real browser for you."

## Keep (everyone liked these)

- Sign-in hero with the looping GitHub-star demo over the meadow; one clear Google button.
- "Never type passwords, codes or keys here" + secure forms; Vault never re-shows secrets; activity log.
- Step checklist with "Needs you" status; rich replies (table, link card, copy).
- OTP field: numeric keypad + SMS autofill; Enter sends; examples fill the box without sending.
- Pet is `aria-hidden` and respects reduced motion; no horizontal overflow on phones.
