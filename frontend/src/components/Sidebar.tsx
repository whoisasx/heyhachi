"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { signOutAction } from "@/app/actions";

export type Section = "chat" | "vault" | "profile";

const NAV: { key: Section; href: string; label: string; icon: ReactNode }[] = [
  { key: "chat", href: "/chat", label: "Chats", icon: <Icon d="M4 5h16v10H8l-4 4z" /> },
  { key: "vault", href: "/accounts", label: "Vault", icon: <Icon d="M6 10V8a6 6 0 0 1 12 0v2M5 10h14v10H5z" /> },
  { key: "profile", href: "/profile", label: "Profile", icon: <Icon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" /> },
];

/** App shell: sidebar (with an optional slot, e.g. the chat list) and the page. */
export function Shell({
  email,
  active,
  slot,
  onNewChat,
  children,
}: {
  email: string;
  active: Section;
  slot?: ReactNode;
  onNewChat?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const initial = (email || "?").charAt(0).toUpperCase();

  return (
    <div className="flex min-h-0 flex-1">
      {open && (
        <button
          aria-label="Close menu"
          className="fixed inset-0 z-20 bg-black/30 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 shrink-0 flex-col gap-5 border-r border-border bg-background px-3 py-5 transition-transform md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Link href="/chat" className="serif px-2 text-[26px] leading-none">
          Browser Agent
        </Link>

        {onNewChat ? (
          <button
            className="btn-primary"
            onClick={() => {
              onNewChat();
              setOpen(false);
            }}
          >
            + New chat
          </button>
        ) : (
          <Link href="/chat" className="btn-primary">
            + New chat
          </Link>
        )}

        {slot && (
          <div className="flex min-h-0 flex-1 flex-col">
            <p className="px-2 pb-1.5 text-[11px] uppercase tracking-wider text-muted">Recent</p>
            <div className="min-h-0 flex-1 overflow-y-auto" onClick={() => setOpen(false)}>
              {slot}
            </div>
          </div>
        )}

        <nav className={`flex flex-col gap-0.5 ${slot ? "" : "flex-1"}`}>
          <p className="px-2 pb-1.5 text-[11px] uppercase tracking-wider text-muted">Account</p>
          {NAV.filter((n) => n.key !== "chat" || !slot).map((n) => (
            <Link
              key={n.key}
              href={n.href}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm ${
                active === n.key ? "bg-sunk font-medium" : "text-foreground/80 hover:bg-sunk"
              }`}
            >
              <span className="text-muted">{n.icon}</span>
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2.5 border-t border-border px-1 pt-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
            {initial}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm" title={email}>
            {email}
          </span>
          <form action={signOutAction}>
            <button type="submit" className="rounded-md px-1.5 py-1 text-xs text-muted hover:bg-sunk hover:text-foreground">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <button
          aria-label="Open menu"
          className="m-2 mb-0 self-start rounded-md px-2 py-1 text-lg md:hidden"
          onClick={() => setOpen(true)}
        >
          ☰
        </button>
        {children}
      </div>
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/** Serif page section with a heavy top rule, like a settings document. */
export function PageSection({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="serif text-[30px] leading-tight">{title}</h2>
          {note && <p className="mt-0.5 text-sm text-muted">{note}</p>}
        </div>
        {action}
      </div>
      <div className="mt-3 border-t border-foreground">{children}</div>
    </section>
  );
}
