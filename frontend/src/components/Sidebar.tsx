"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { signOutAction } from "@/app/actions";
import { api } from "@/lib/api";
import { setTheme, useThemePref, type ThemePref } from "@/lib/theme";

// ---- signed-in user, shared with pages ------------------------------------------

const UserContext = createContext<{ email: string; name: string | null }>({ email: "", name: null });
export const useUser = () => useContext(UserContext);

// ---- chat list refresh: pages call this after sending or when a task ends --------

const CHATS_CHANGED = "chats:changed";
export const refreshChats = () => window.dispatchEvent(new Event(CHATS_CHANGED));

interface Summary {
  id: string;
  title: string | null;
  active_task_id: string | null;
}

const NAV = [
  { href: "/accounts", label: "Vault", icon: <Icon d="M5 3h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14 11.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM11.5 9V7.5M11.5 15.5V14M17.5 9.5v4M6.5 20v1.5M17.5 20v1.5" /> },
  { href: "/profile", label: "Profile", icon: <Icon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" /> },
  {
    href: "/settings",
    label: "Settings",
    icon: <Icon d="M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4" />,
  },
];

/** App shell. Lives in the shared layout, so it stays mounted while you switch pages. */
export function Shell({ email, name, children }: { email: string; name: string | null; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <UserContext.Provider value={{ email, name }}>
      <div className="flex min-h-0 flex-1">
        {open && (
          <button aria-label="Close menu" className="fixed inset-0 z-20 bg-black/30 md:hidden" onClick={() => setOpen(false)} />
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-30 flex w-64 shrink-0 flex-col gap-5 border-r border-border bg-background px-3 py-5 transition-transform md:static md:translate-x-0 ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setOpen(false); // close the phone menu after navigating
          }}
        >
          <Link href="/chat" className="display px-2 text-[1.3rem] leading-none">
            Browser Agent
          </Link>
          <Link href="/chat" className="btn-primary">
            + New chat
          </Link>

          <div className="flex min-h-0 flex-1 flex-col">
            <p className="px-2 pb-1.5 text-[0.68rem] uppercase tracking-wider text-muted">Recent</p>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Suspense fallback={<ListSkeleton />}>
                <ChatList onChat={pathname === "/chat"} />
              </Suspense>
            </div>
          </div>

          <nav className="flex flex-col gap-0.5">
            <p className="px-2 pb-1.5 text-[0.68rem] uppercase tracking-wider text-muted">Account</p>
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm ${
                  pathname === n.href ? "bg-sunk font-medium" : "text-foreground/80 hover:bg-sunk"
                }`}
              >
                <span className="text-muted">{n.icon}</span>
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2.5 border-t border-border px-1 pt-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
              {(email || "?").charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm" title={email}>
              {email}
            </span>
            <ThemeCycle />
            <form action={signOutAction}>
              <button type="submit" className="rounded-md px-1.5 py-1 text-xs text-muted hover:bg-sunk hover:text-foreground">
                Sign out
              </button>
            </form>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <button aria-label="Open menu" className="m-2 mb-0 self-start rounded-md px-2 py-1 text-lg md:hidden" onClick={() => setOpen(true)}>
            ☰
          </button>
          {children}
        </div>
      </div>
    </UserContext.Provider>
  );
}

function ChatList({ onChat }: { onChat: boolean }) {
  const activeId = useSearchParams().get("c");
  const [chats, setChats] = useState<Summary[] | null>(null);

  const load = useCallback(
    () =>
      api<{ items: Summary[] }>("/conversations?limit=50").then(
        (list) => setChats(list.items),
        () => {},
      ),
    [],
  );

  useEffect(() => {
    void load();
    window.addEventListener(CHATS_CHANGED, load);
    return () => window.removeEventListener(CHATS_CHANGED, load);
  }, [load]);

  // Keep the "running" dots fresh while something runs.
  const running = chats?.some((c) => c.active_task_id);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [running, load]);

  if (chats === null) return <ListSkeleton />;
  if (chats.length === 0) return <p className="px-2.5 text-sm text-muted">No chats yet</p>;
  return (
    <ul className="flex flex-col gap-0.5">
      {chats.map((c) => (
        <li key={c.id}>
          <Link
            href={`/chat?c=${c.id}`}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${
              onChat && c.id === activeId ? "bg-sunk font-medium" : "text-foreground/80 hover:bg-sunk"
            }`}
          >
            {c.active_task_id && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />}
            <span className="truncate">{c.title ?? "New chat"}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-2.5 pt-1">
      {[70, 85, 55, 75].map((w) => (
        <span key={w} className="h-4 animate-pulse rounded bg-sunk" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

/** Shown once, on first load, while the sign-in check runs. Same shape as the shell. */
export function ShellSkeleton() {
  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-64 shrink-0 flex-col gap-5 border-r border-border px-3 py-5 md:flex">
        <span className="display px-2 text-[1.3rem] leading-none">Browser Agent</span>
        <span className="h-9 animate-pulse rounded-lg bg-sunk" />
        <ListSkeleton />
      </aside>
      <div className="flex-1" />
    </div>
  );
}

const THEMES: { pref: ThemePref; label: string; icon: string }[] = [
  { pref: "system", label: "System", icon: "M4 5h16v11H4zM9 20h6M12 16v4" },
  { pref: "light", label: "Light", icon: "M12 4V2M12 22v-2M4 12H2M22 12h-2M6 6 4.6 4.6M19.4 19.4 18 18M6 18l-1.4 1.4M19.4 4.6 18 6M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" },
  { pref: "dark", label: "Dark", icon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" },
];

/** Small sidebar button: system → light → dark. */
function ThemeCycle() {
  const pref = useThemePref();
  const i = THEMES.findIndex((t) => t.pref === pref);
  const next = THEMES[(i + 1) % THEMES.length];
  return (
    <button
      type="button"
      title={`Theme: ${THEMES[i].label} (click for ${next.label})`}
      aria-label={`Theme: ${THEMES[i].label}`}
      className="rounded-md p-1.5 text-muted hover:bg-sunk hover:text-foreground"
      onClick={() => setTheme(next.pref)}
    >
      <Icon d={THEMES[i].icon} />
    </button>
  );
}

/** System / Light / Dark segmented control, for the Settings page. */
export function ThemeSwitch() {
  const pref = useThemePref();
  return (
    <div className="inline-flex rounded-xl border border-border bg-sunk p-1">
      {THEMES.map((t) => (
        <button
          key={t.pref}
          type="button"
          onClick={() => setTheme(t.pref)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
            pref === t.pref ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-foreground"
          }`}
        >
          <Icon d={t.icon} />
          {t.label}
        </button>
      ))}
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

/** Page section: heading, note and a rule, with rows below. */
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
          <h2 className="display text-[1.5rem] leading-tight">{title}</h2>
          {note && <p className="mt-0.5 text-sm text-muted">{note}</p>}
        </div>
        {action}
      </div>
      <div className="mt-3 border-t border-foreground">{children}</div>
    </section>
  );
}
