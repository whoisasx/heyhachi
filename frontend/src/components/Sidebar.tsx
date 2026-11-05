"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { signOutAction } from "@/app/actions";
import { ApiError, api, loadChat } from "@/lib/api";
import { useConfirm } from "./Confirm";
import { Paw, Wordmark } from "./Logo";
import { Pet } from "./Pet";
import { setRoam, useRoam } from "@/lib/pet";
import { setTheme, useThemePref, type ThemePref } from "@/lib/theme";

// ---- signed-in user, shared with pages ------------------------------------------

const UserContext = createContext<{ email: string; name: string | null }>({ email: "", name: null });
export const useUser = () => useContext(UserContext);

// ---- chat list refresh: pages call this after sending or when a task ends --------

const CHATS_CHANGED = "chats:changed";
export const refreshChats = () => window.dispatchEvent(new Event(CHATS_CHANGED));
/** Fired after a chat is renamed in the sidebar, so the open chat's header updates too. */
export const CHAT_RENAMED = "chat:renamed";

interface Summary {
  id: string;
  title: string | null;
  updated_at?: string;
  active_task_id: string | null;
  active_task_status?: string | null;
}

/** "Today", "Yesterday", "Previous 7 days", "Older" */
function dayGroup(iso?: string) {
  if (!iso) return "Older";
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const days = Math.floor((start.getTime() - new Date(iso).getTime()) / 86_400_000) + 1;
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days <= 7 ? "Previous 7 days" : "Older";
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
  const router = useRouter();

  // Shortcuts: ⌘K / Ctrl+K search chats, ⌘⇧O / Ctrl+Shift+O new chat, "/" jump to the message box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]");
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true); // phones: the list lives in the menu
        requestAnimationFrame(() => document.getElementById("chat-search")?.focus());
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        router.push("/chat");
        setTimeout(() => document.getElementById("composer")?.focus(), 50);
      } else if (e.key === "/" && !mod && !typing) {
        const box = document.getElementById("composer");
        if (box) {
          e.preventDefault();
          box.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <UserContext.Provider value={{ email, name }}>
      <a
        href="#content"
        className="sr-only z-50 rounded-lg bg-foreground px-3 py-2 text-sm text-background focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      <div className="flex min-h-0 flex-1">
        {open && (
          <button aria-label="Close menu" className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-30 flex w-64 shrink-0 flex-col gap-5 border-r border-border bg-background px-3 py-5 transition-transform lg:static lg:translate-x-0 ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setOpen(false); // close the phone menu after navigating
          }}
        >
          <Link href="/chat" className="px-2 text-[1.3rem] leading-none">
            <Wordmark />
          </Link>
          <Link href="/chat" className="btn-primary" title="New chat (⌘⇧O)">
            + New chat
          </Link>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
              <Suspense fallback={<ListSkeleton />}>
                <ChatList onChat={pathname === "/chat"} />
              </Suspense>
            </div>
          </div>

          <PetSwitch />

          <nav className="-mt-3 flex flex-col gap-0.5">
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
              <button type="submit" className="rounded-md px-1.5 py-1 text-xs text-muted hover:bg-sunk hover:text-foreground pointer-coarse:px-2.5 pointer-coarse:py-3">
                Sign out
              </button>
            </form>
          </div>
        </aside>

        <div id="content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
          {/* phones and tablets: a slim bar with the menu button, so it never sits on top of content */}
          <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-1 lg:hidden">
            <button aria-label="Open menu" className="grid h-11 w-11 place-items-center rounded-md text-lg" onClick={() => setOpen(true)}>
              ☰
            </button>
            <Link href="/chat" className="shrink-0 text-[1.1rem] leading-none">
              <Wordmark />
            </Link>
            {/* the open chat puts its title here (ChatApp), after a thin divider */}
            <div id="topbar-slot" className="flex min-w-0 flex-1 items-center gap-2 pr-3 empty:hidden" />
          </div>
          {children}
        </div>
      </div>
      <Pet />
    </UserContext.Provider>
  );
}

const PER_DAY = 10;
const FOLD_KEY = "hachi:folded-days";
const OPEN_BY_DEFAULT = new Set(["Today", "Yesterday"]);

function ChatList({ onChat }: { onChat: boolean }) {
  const activeId = useSearchParams().get("c");
  const [chats, setChats] = useState<Summary[] | null>(null);
  const [query, setQuery] = useState("");
  // Day groups fold open/closed (remembered); a day with many chats shows the first few.
  // (read on first render: the groups only show after chats load on the client, so no hydration mismatch)
  const [folded, setFolded] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(FOLD_KEY) ?? "{}");
    } catch {
      return {}; // server render, or storage blocked
    }
  });
  const [more, setMore] = useState<Set<string>>(new Set());
  const fold = (label: string, close: boolean) =>
    setFolded((f) => {
      const next = { ...f, [label]: close };
      try {
        localStorage.setItem(FOLD_KEY, JSON.stringify(next));
      } catch {
        /* storage blocked */
      }
      return next;
    });

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
  // A chat with no title never got a message: don't list it (unless it's the open one).
  const all = chats.filter((c) => c.title || (onChat && c.id === activeId));
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((c) => (c.title ?? "").toLowerCase().includes(q)) : all;
  const groups: { label: string; items: Summary[] }[] = [];
  for (const c of shown) {
    const label = dayGroup(c.updated_at);
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
    groups.at(-1)!.items.push(c);
  }
  const search = all.length > 5 && (
    <div className="px-1 pb-2">
      <input
        id="chat-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setQuery("")}
        placeholder="Search chats  ⌘K"
        aria-label="Search chats"
        className="w-full rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted focus:border-accent"
      />
    </div>
  );
  if (q && shown.length === 0)
    return (
      <>
        {search}
        <p className="px-2.5 text-sm text-muted">No chats match “{query.trim()}”</p>
      </>
    );
  if (all.length === 0) return <p className="px-2.5 text-sm text-muted">No chats yet</p>;
  return (
    <>
      {search}
      {groups.map((g) => {
        const hasActive = onChat && g.items.some((c) => c.id === activeId);
        // searching shows every match; the open chat's group is always open
        const closed = folded[g.label] ?? !OPEN_BY_DEFAULT.has(g.label);
        const isOpen = !!q || hasActive || !closed;
        // the first few, plus the open chat if it's further down
        const items =
          q || more.has(g.label) ? g.items : g.items.filter((c, i) => i < PER_DAY || (onChat && c.id === activeId));
        const hidden = g.items.length - items.length;
        return (
          <section key={g.label} aria-label={g.label} className="pb-3">
            <h2>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => !q && !hasActive && fold(g.label, isOpen)}
                className="group/day flex w-full items-center gap-1 rounded px-2 pb-1 text-[0.68rem] uppercase tracking-wider text-muted hover:text-foreground"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
                {g.label}
                {!isOpen && <span className="ml-auto normal-case tracking-normal tabular-nums">{g.items.length}</span>}
              </button>
            </h2>
            {isOpen && (
              <ul className="flex flex-col gap-0.5">
                {items.map((c) => (
                  <ChatRow
                    key={c.id}
                    chat={c}
                    active={onChat && c.id === activeId}
                    onRenamed={(title) => setChats((list) => list?.map((x) => (x.id === c.id ? { ...x, title } : x)) ?? null)}
                    onDeleted={() => setChats((list) => list?.filter((x) => x.id !== c.id) ?? null)}
                  />
                ))}
                {!q && (hidden > 0 || more.has(g.label)) && (
                  <li>
                    <button
                      type="button"
                      onClick={() =>
                        setMore((s) => {
                          const n = new Set(s);
                          if (n.has(g.label)) n.delete(g.label);
                          else n.add(g.label);
                          return n;
                        })
                      }
                      className="rounded-md px-2.5 py-1 text-xs text-muted hover:text-foreground"
                    >
                      {more.has(g.label) ? "See less" : "See more"}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}

/** One chat in the sidebar. Hover shows rename and delete. */
function ChatRow({
  chat,
  active,
  onRenamed,
  onDeleted,
}: {
  chat: Summary;
  active: boolean;
  onRenamed: (title: string) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(chat.title ?? "");
  const [busy, setBusy] = useState(false);
  const [dialog, confirm] = useConfirm();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  async function save() {
    const title = name.trim();
    setEditing(false);
    if (!title || title === chat.title) return setName(chat.title ?? "");
    onRenamed(title); // show it right away
    try {
      await api(`/conversations/${chat.id}`, { method: "PATCH", body: JSON.stringify({ title }) });
      window.dispatchEvent(new CustomEvent(CHAT_RENAMED, { detail: { id: chat.id, title } }));
    } catch {
      onRenamed(chat.title ?? "");
      setName(chat.title ?? "");
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this chat?",
      body: chat.active_task_id
        ? "Its running task is stopped and the whole conversation is deleted. This can't be undone."
        : "The whole conversation is deleted. This can't be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/conversations/${chat.id}`, { method: "DELETE" });
      onDeleted();
      if (active) window.history.pushState(null, "", "/chat"); // instant; Next keeps the URL hooks in sync
    } catch (err) {
      setBusy(false);
      window.alert(err instanceof ApiError ? err.message : "Couldn't delete the chat.");
    }
  }

  if (editing)
    return (
      <li>
        <input
          ref={input}
          aria-label="Chat name"
          className="w-full rounded-lg border border-accent bg-background px-2.5 py-1.5 text-sm outline-none"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setName(chat.title ?? "");
              setEditing(false);
            }
          }}
        />
      </li>
    );

  return (
    <li className={`group relative ${busy ? "pointer-events-none opacity-50" : ""}`}>
      {dialog}
      <Link
        href={`/chat?c=${chat.id}`}
        data-pet={active ? "active-chat" : undefined}
        onMouseEnter={() => void loadChat(chat.id).catch(() => {})}
        className={`flex w-full items-center gap-2 rounded-lg py-1.5 pl-2.5 pr-2.5 text-left text-sm group-hover:pr-14 group-focus-within:pr-14 pointer-coarse:min-h-11 ${active ? "pointer-coarse:pr-20" : ""} ${
          active ? "bg-sunk font-medium" : "text-foreground/80 hover:bg-sunk"
        }`}
      >
        {chat.active_task_id &&
          (chat.active_task_status === "waiting_user" ? (
            <span className="h-2 w-2 shrink-0 rounded-full bg-warn" title="Needs you">
              <span className="sr-only">Needs you:</span>
            </span>
          ) : (
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" title="Working">
              <span className="sr-only">Working:</span>
            </span>
          ))}
        <span className="truncate" title={chat.title ?? undefined}>
          {chat.title ?? "New chat"}
        </span>
      </Link>
      {/* hover or keyboard shows them; on touch screens the open chat always shows them */}
      <span
        className={`absolute right-1 top-1/2 hidden -translate-y-1/2 items-center group-hover:flex group-focus-within:flex ${
          active ? "pointer-coarse:flex" : ""
        }`}
      >
        <RowButton label="Rename" onClick={() => setEditing(true)} d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
        <RowButton label="Delete" onClick={() => void remove()} d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" danger />
      </span>
    </li>
  );
}

function RowButton({ label, onClick, d, danger }: { label: string; onClick: () => void; d: string; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-background pointer-coarse:h-9 pointer-coarse:w-9 ${danger ? "hover:text-danger" : "hover:text-foreground"}`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={d} />
      </svg>
    </button>
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
      <aside className="hidden w-64 shrink-0 flex-col gap-5 border-r border-border px-3 py-5 lg:flex">
        <span className="px-2 text-[1.3rem] leading-none">
          <Wordmark />
        </span>
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
/** The top of Vault, Profile and Settings: one title style, and the tab title to match. */
export function PageHeader({ title, note, children }: { title: string; note?: ReactNode; children?: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Hachi`;
    return () => {
      document.title = "Hachi · The loyal agent";
    };
  }, [title]);
  return (
    <header>
      <h1 className="display text-[1.75rem] leading-tight">{title}</h1>
      {note && <p className="mt-1 max-w-xl text-sm text-muted">{note}</p>}
      {children}
    </header>
  );
}

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
          <h2 className="font-mono text-[0.7rem] uppercase tracking-wider text-muted">{title}</h2>
          {note && <p className="mt-1 text-sm text-muted">{note}</p>}
        </div>
        {action}
      </div>
      {/* not overflow-hidden, so dropdowns inside can open past the edge */}
      <div className="mt-3 rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)] [&>*:last-child]:border-b-0">
        {children}
      </div>
    </section>
  );
}

/** Turns Hachi's roaming on and off. */
function PetSwitch() {
  const roam = useRoam();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={roam}
      data-pet="switch"
      onClick={() => setRoam(!roam)}
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-foreground/80 hover:bg-sunk"
    >
      <Paw size={16} className="text-accent" />
      <span className="flex-1 text-left">Let Hachi roam</span>
      <span className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${roam ? "bg-accent" : "bg-border"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${roam ? "left-3.5" : "left-0.5"}`} />
      </span>
    </button>
  );
}
