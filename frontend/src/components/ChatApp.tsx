"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ApiError, api, cachedChat, loadChat, post, type ConversationDetail, type TaskStatus } from "@/lib/api";
import { CHAT_RENAMED, refreshChats, useUser } from "./Sidebar";
import { BoxMeadow } from "./ChatScene";
import { LivePanel } from "./LivePanel";
import { Paw } from "./Logo";
import { TaskView } from "./TaskView";

const EXAMPLES = [
  {
    title: "Order food on Swiggy",
    prompt: "Order a paneer biryani on Swiggy to my saved address. Show me the total before you pay.",
    site: "swiggy.com",
    icon: "M4 11h16a8 8 0 0 1-16 0zM12 3v4M8 5l1 2M16 5l-1 2M3 21h18",
  },
  {
    title: "Generate a video",
    prompt: "Generate a 5-second video of a loyal Akita waiting at a train station, using a free AI video site.",
    site: "AI video site",
    icon: "M3 6h12v12H3zM15 10l6-3v10l-6-3",
  },
  {
    title: "Book a table",
    prompt: "Find a well-rated restaurant near me with a table for 2 tomorrow at 8pm. Ask me before booking.",
    site: "zomato.com",
    icon: "M5 3v8a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3M7 13v8M17 3c-1.7 0-3 2-3 5s1.3 4 3 4v9",
  },
  {
    title: "Find a cheap flight",
    prompt: "Find the cheapest one-way flight from Bengaluru to Delhi next Friday and show me the top 3.",
    site: "google.com/travel",
    icon: "M2 16l20-6-9 11-2-7zM11 14 2 16",
  },
  {
    title: "Fill a form",
    prompt: "Open the form at the link I'll give you, fill it with my profile details, and show me before submitting.",
    site: "any website",
    icon: "M5 3h14v18H5zM9 8h6M9 12h6M9 16h3",
  },
  {
    title: "Check a repo's stars",
    prompt: "How many stars does whoisasx/heyhachi have on GitHub?",
    site: "github.com",
    icon: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  },
];

function greeting(name: string | null) {
  const h = new Date().getHours();
  const part = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const first = name?.split(" ")[0];
  return first ? `${part}, ${first}` : part;
}

export function ChatApp() {
  // The open chat lives in the URL (?c=), so sidebar links and back/forward just work.
  const activeId = useSearchParams().get("c");
  const { name } = useUser();
  const [loaded, setLoaded] = useState<ConversationDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [stopping, setStopping] = useState(false);
  const [liveView, setLiveView] = useState<{ taskId: string; url: string; site?: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Only show what belongs to the open chat (the previous one may still be in state).
  // A chat seen before shows straight from the cache while the fresh copy loads.
  const detail = loaded?.id === activeId ? loaded : activeId ? cachedChat(activeId) : null;
  const live = liveView && detail?.tasks.some((t) => t.id === liveView.taskId) ? liveView : null;

  const loadDetail = useCallback(
    (id: string) => loadChat(id).then(setLoaded),
    [setLoaded],
  );

  useEffect(() => {
    if (activeId) {
      loadDetail(activeId).catch(() => setError({ chat: activeId, text: "Couldn't load that conversation." }));
    }
  }, [activeId, loadDetail]);

  useEffect(() => {
    const onRename = (e: Event) => {
      const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
      setLoaded((cur) => (cur?.id === id ? { ...cur, title } : cur));
    };
    window.addEventListener(CHAT_RENAMED, onRename);
    return () => window.removeEventListener(CHAT_RENAMED, onRename);
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages.length]);

  const taskStatus = (taskId: string): TaskStatus =>
    detail?.tasks.find((t) => t.id === taskId)?.status ?? "queued";
  // Task views report status as it streams in, ahead of the chat's next refresh.
  const [liveStatus, setLiveStatus] = useState<Record<string, TaskStatus>>({});
  const onStatus = useCallback((taskId: string, status: TaskStatus) => {
    setLiveStatus((cur) => (cur[taskId] === status ? cur : { ...cur, [taskId]: status }));
  }, []);
  const activeTask = detail?.tasks
    .map((t) => ({ ...t, status: liveStatus[t.id] ?? t.status }))
    .find((t) => !["done", "failed", "cancelled"].includes(t.status));
  const busy = !!activeTask;
  const needsYou = activeTask?.status === "waiting_user";

  // The tab title says when Hachi is working or waiting on you, so you notice from another tab.
  useEffect(() => {
    const base = "Hachi · The loyal agent";
    document.title = needsYou ? "(1) Needs you · Hachi" : busy ? "Working… · Hachi" : base;
    return () => {
      document.title = base;
    };
  }, [busy, needsYou]);

  // The message box gets the keyboard when a chat opens and when a task ends
  // (not on touch screens, where that would pop up the keyboard).
  useEffect(() => {
    if (busy || matchMedia("(pointer: coarse)").matches) return;
    const a = document.activeElement;
    if (!a || a === document.body || a.id === "content") input.current?.focus({ preventScroll: true });
  }, [activeId, busy]);

  // Errors belong to the chat they happened in; switching chats hides them.
  const shownError = error && error.chat === activeId ? error : null;

  async function stop() {
    if (!activeTask || stopping) return;
    setStopping(true);
    try {
      await post(`/tasks/${activeTask.id}/cancel`, {});
      if (activeId) await loadDetail(activeId);
      refreshChats();
    } catch (err) {
      setError({ chat: activeId, text: err instanceof Error ? err.message : "Couldn't stop the task." });
    } finally {
      setStopping(false);
      input.current?.focus();
    }
  }

  // Fallback for a dropped live stream: refresh while a task is running.
  useEffect(() => {
    if (!busy || !activeId) return;
    const id = setInterval(() => {
      void loadDetail(activeId).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [busy, activeId, loadDetail]);

  const onLiveView = useCallback((taskId: string, url: string | null, site?: string) => {
    setLiveView((cur) => (url ? { taskId, url, site } : cur?.taskId === taskId ? null : cur));
  }, [setLiveView]);

  async function send(e: { preventDefault(): void }) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || sending || busy) return;
    setSending(true);
    setError(null);
    let created: string | null = null;
    try {
      let id = activeId;
      if (!id) {
        id = created = (await post<{ id: string }>("/conversations", {})).id;
        window.history.pushState(null, "", `/chat?c=${id}`); // Next keeps useSearchParams in sync
      }
      await post(`/conversations/${id}/messages`, {
        content,
        client_message_id: crypto.randomUUID(),
      });
      await loadDetail(id);
      setDraft(""); // only now: the message shows in the chat and leaves the box
      refreshChats();
    } catch (err) {
      // A new chat whose first message was refused would sit empty in the sidebar: drop it.
      if (created) {
        void api(`/conversations/${created}`, { method: "DELETE" }).catch(() => {});
        window.history.replaceState(null, "", "/chat");
      }
      const chat = created ? null : activeId;
      if (err instanceof ApiError && err.code === "secret_in_message") {
        setError({ chat, text: err.message, secret: true });
      } else if (err instanceof ApiError && err.code === "too_many_active_tasks") {
        const running = (err.details.running as RunningTask[] | undefined) ?? [];
        setError({ chat, text: err.message, running: running.length ? running : undefined });
      } else {
        setError({ chat, text: err instanceof Error ? err.message : "Couldn't send.", retry: true });
      }
    } finally {
      setSending(false);
      setTimeout(() => input.current?.focus(), 0); // after a new chat's box has moved to the bottom
    }
  }

  // Typing feel: the bottom line glows while keys are going, and fades a moment after.
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onType = () => {
    setTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 700);
  };
  // After sending, the box shrinks back to its normal size.
  useEffect(() => {
    if (!draft && input.current) input.current.style.height = "";
  }, [draft]);
  const hint = useTypewriter(!draft && !busy);

  const title = detail?.title;
  const topbarSlot = useSyncExternalStore(
    noSubscribe,
    () => document.getElementById("topbar-slot"),
    () => null,
  );
  const chatHeading = (
    <>
      <h1 className="display min-w-0 truncate text-[1.05rem] leading-tight">{title ?? "New chat"}</h1>
      <span role="status" className="contents">
        {busy && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs ${
              needsYou ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent"
            }`}
          >
            ● {needsYou ? "Needs you" : "Working"}
          </span>
        )}
      </span>
    </>
  );
  // A brand-new chat: the input box sits in the middle of the page, like a home screen.
  // While the first message of a new chat is sending, stay on that screen.
  const firstSend = sending && !detail?.messages.length;
  const empty = firstSend || ((!activeId || (detail !== null && !detail.messages.length)) && !sending);
  // Show "Working…" under the chat while a task runs and isn't waiting on the user.
  const working = busy && !needsYou;

  function editMessage(text: string) {
    setDraft(text);
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    });
  }

  const composer = (
      <form onSubmit={send} className={empty ? "w-full" : "px-4 pb-5 pt-2 sm:px-6"}>
        {/* Hachi sits on top of this: the box, and any warning above it */}
        <div data-pet="composer" className={`mx-auto ${empty ? "max-w-2xl" : "max-w-3xl"}`}>
          {shownError && (
            <div role="alert" className="mb-2 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-foreground">
              {shownError.running
                ? `${shownError.running.length === 1 ? "A task is" : `${shownError.running.length} tasks are`} still running. Stop one, or wait for it to finish:`
                : shownError.text}
              {shownError.running?.map((r) => (
                <span key={r.task_id} className="mt-1.5 flex items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
                  <span className="min-w-0 truncate font-medium">{r.title}</span>
                  <Link href={`/chat?c=${r.conversation_id}`} className="ml-auto shrink-0 rounded-md px-2 py-0.5 text-xs underline underline-offset-2 hover:bg-sunk">
                    Open
                  </Link>
                  <button
                    type="button"
                    className="shrink-0 rounded-md px-2 py-0.5 text-xs underline underline-offset-2 hover:bg-sunk"
                    onClick={async () => {
                      await post(`/tasks/${r.task_id}/cancel`, {}).catch(() => {});
                      setError((cur) => {
                        const left = cur?.running?.filter((x) => x.task_id !== r.task_id) ?? [];
                        return left.length ? { ...cur!, running: left } : null;
                      });
                      refreshChats();
                      input.current?.focus();
                    }}
                  >
                    Stop it
                  </button>
                </span>
              ))}
              {shownError.retry && (
                <button type="button" className="ml-2 underline underline-offset-2" onClick={send}>
                  Try again
                </button>
              )}
              {shownError.secret && (
                <>
                  {" "}
                  It wasn&apos;t sent or saved. Add it in the{" "}
                  <Link href="/accounts" className="underline">
                    Vault
                  </Link>{" "}
                  instead.
                </>
              )}
            </div>
          )}
          <div
            data-typing={typing || undefined}
            className="composer relative isolate overflow-hidden rounded-2xl border border-border bg-surface/85 p-3 pb-2.5 shadow-[0_6px_24px_rgba(0,0,0,0.05)] backdrop-blur-md"
          >
            <BoxMeadow />
            {/* a soft line along the bottom: draws in on focus, glows while you type */}
            <span className="composer-line" aria-hidden />
            <textarea
              ref={input}
              id="composer"
              aria-label="Message Hachi"
              className="composer-input block max-h-52 w-full resize-none bg-transparent px-1 pt-0.5 outline-none placeholder:text-muted"
              rows={empty ? 3 : 2}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                onType();
                // grow with the text, up to the max height
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(e);
                }
              }}
              placeholder={busy ? "Hachi is on it. You can write your next message…" : hint}
              readOnly={sending}
              maxLength={4000}
            />
            <div className="mt-1 flex items-center gap-2">
              <Guardrails />
              {busy && !sending ? (
                <button
                  type="button"
                  onClick={stop}
                  disabled={stopping}
                  aria-label="Stop the task"
                  title="Stop the task. Nothing more is done on your accounts."
                  className="ml-auto flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface pl-3 pr-3.5 text-sm font-medium transition hover:border-danger hover:text-danger disabled:opacity-50"
                >
                  <span className="h-2.5 w-2.5 rounded-[3px] bg-current" aria-hidden />
                  {stopping ? "Stopping…" : "Stop"}
                </button>
              ) : (
              <>
              {draft.length > 3500 && (
                <span className={`ml-auto font-mono text-xs tabular-nums ${draft.length >= 4000 ? "text-danger" : "text-muted"}`}>
                  {4000 - draft.length}
                </span>
              )}
              <button
                aria-label={sending ? "Sending" : "Send"}
                title="Send (Enter) · new line (Shift+Enter)"
                className={`grid h-9 w-9 place-items-center rounded-full transition ${draft.length > 3500 ? "" : "ml-auto"} ${
                  draft.trim() && !sending
                    ? "bg-accent text-white shadow-[0_4px_14px_color-mix(in_srgb,var(--accent)_45%,transparent)] hover:scale-105"
                    : "bg-foreground text-background"
                } ${sending ? "" : "disabled:opacity-30"}`}
                disabled={sending || busy || !draft.trim()}
              >
                {sending ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                )}
              </button>
              </>
              )}
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-muted">
            Never type passwords, codes or keys here. I&apos;ll ask for them with a secure form.
          </p>
        </div>
      </form>
  );

  return (
      <div className="flex min-h-0 flex-1">
        <main className="relative isolate flex min-w-0 flex-1 flex-col">
          {activeId && detail && (
            <>
              {/* wide screens: its own slim bar; phones and tablets: next to "Hachi" in the top bar */}
              <div className="hidden items-center gap-3 border-b border-border px-6 py-2.5 lg:flex">{chatHeading}</div>
              {topbarSlot &&
                createPortal(
                  <>
                    <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
                    {chatHeading}
                  </>,
                  topbarSlot,
                )}
            </>
          )}

          <div className="flex-1 overflow-y-auto">
            {/* extra room at the bottom so Hachi, sitting on the message box, never covers the last card */}
            <div role="log" aria-label="Conversation" className="mx-auto flex max-w-3xl flex-col gap-5 px-4 pb-16 pt-7 sm:px-6">
              {activeId && !detail && !sending && (
                <div className="flex flex-col gap-4 pt-2">
                  <span className="h-10 w-1/2 self-end animate-pulse rounded-2xl bg-sunk" />
                  <span className="ml-10 h-12 animate-pulse rounded-2xl bg-sunk" />
                  <span className="ml-10 h-4 w-2/3 animate-pulse rounded bg-sunk" />
                </div>
              )}
              {empty && (
                <div className="relative mt-[10vh] flex flex-col items-center text-center">
                  <span className="relative mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1 text-xs text-muted backdrop-blur">
                    <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                    {greeting(name)}
                  </span>
                  <h1 className="display relative text-[2.6rem] leading-[1.05] sm:text-5xl">
                    What should I
                    <br />
                    <span className="text-accent">get done?</span>
                  </h1>
                  <p className="relative mt-4 max-w-md text-sm leading-relaxed text-muted">
                    An AI agent that does tasks for you in a real browser. Your logins, codes and keys stay out of
                    the chat, and I ask before paying.
                  </p>
                  <div className="relative mt-8 w-full text-left">{composer}</div>
                  <div className="relative mt-6 grid w-full max-w-2xl gap-3 text-left sm:grid-cols-3">
                    {EXAMPLES.map((ex) => (
                      <button
                        key={ex.title}
                        onClick={() => editMessage(ex.prompt)}
                        className="group rounded-2xl border border-border bg-surface p-3.5 text-left transition hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-[0_10px_30px_rgba(47,91,234,0.12)]"
                      >
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-accent">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d={ex.icon} />
                          </svg>
                        </span>
                        <span className="mt-3 block text-sm font-medium">{ex.title}</span>
                        <span className="mt-0.5 block text-xs text-muted">{ex.site}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {detail?.messages.map((m) => (
                <div key={m.id} className="flex flex-col gap-3">
                  <Bubble
                    role={m.role}
                    text={m.content}
                    at={m.created_at}
                    onEdit={m.role === "user" && !busy ? () => editMessage(m.content) : undefined}
                  />
                  {m.role === "user" && m.task_id && (
                    <TaskView
                      key={m.task_id}
                      taskId={m.task_id}
                      initialStatus={taskStatus(m.task_id)}
                      brief={detail.tasks.find((t) => t.id === m.task_id)}
                      latest={detail.tasks.at(-1)?.id === m.task_id}
                      onLiveView={onLiveView}
                      onStatus={onStatus}
                      onFinished={() => {
                        if (activeId) void loadDetail(activeId);
                        refreshChats();
                      }}
                    />
                  )}
                </div>
              ))}
              {working && <Working />}
              <div ref={bottom} />
            </div>
          </div>

          {!empty && composer}
        </main>

        {live && <LivePanel url={live.url} site={live.site} onStop={busy ? stop : undefined} stopping={stopping} />}
      </div>
  );
}

/**
 * The empty box's placeholder types out example tasks, one after another, so it's
 * clear what you can ask. Still (just the first line) with reduced motion.
 */
const HINTS = [
  "Order a paneer biryani on Swiggy…",
  "Find the cheapest flight to Delhi next Friday…",
  "Book a table for two tomorrow at 8pm…",
  "Star whoisasx/heyhachi on GitHub…",
  "Describe what you want done on a website…",
];
function useTypewriter(on: boolean) {
  const [text, setText] = useState(HINTS.at(-1)!);
  useEffect(() => {
    if (!on || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let hint = 0;
    let chars = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const full = HINTS[hint];
      chars += deleting ? -1 : 1;
      setText(full.slice(0, chars) || "\u200b");
      let wait = deleting ? 22 : 55;
      if (!deleting && chars === full.length) {
        deleting = true;
        wait = 2200;
      } else if (deleting && chars === 0) {
        deleting = false;
        hint = (hint + 1) % HINTS.length;
        wait = 400;
      }
      timer = setTimeout(step, wait);
    };
    timer = setTimeout(step, 600);
    return () => {
      clearTimeout(timer);
      setText(HINTS.at(-1)!);
    };
  }, [on]);
  return text;
}

/** The top bar slot never changes once mounted, so there is nothing to subscribe to. */
const noSubscribe = () => () => {};

interface RunningTask {
  task_id: string;
  conversation_id: string;
  title: string;
}
interface ChatError {
  chat: string | null; // the chat it happened in
  text: string;
  secret?: boolean; // a secret was pasted: point to the Vault
  retry?: boolean; // a network-ish failure: "Try again" resends
  running?: RunningTask[]; // too many tasks: name them, with Open / Stop
}

/** What the assistant may do on its own: shown next to the send button. */
function Guardrails() {
  const items = [
    { icon: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6", text: "Up to $1 per task", tip: "A task stops before it spends more than $1 on AI and browser time." },
    { icon: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z M9 12l2 2 4-4", text: "Asks before paying", tip: "Paying, ordering, sending and deleting always wait for your OK." },
  ];
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      {items.map((it, i) => (
        <span
          key={it.text}
          title={it.tip}
          className={`items-center gap-1.5 rounded-full bg-sunk px-2.5 py-1 text-xs text-muted ${i ? "hidden sm:inline-flex" : "inline-flex"}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={it.icon} />
          </svg>
          {it.text}
        </span>
      ))}
    </span>
  );
}

const timeOf = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString(undefined, {
    ...(sameDay ? {} : { day: "numeric", month: "short" }),
    hour: "numeric",
    minute: "2-digit",
  });
};

function Bubble({ role, text, at, onEdit }: { role: string; text: string; at: string; onEdit?: () => void }) {
  if (role === "user")
    return (
      <div className="msg-in group flex flex-col items-end gap-1">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[1.25rem] rounded-br-md border border-accent/15 bg-accent-soft px-4 py-2.5 text-[0.95rem] leading-relaxed text-foreground">
          {text}
        </div>
        <MessageActions text={text} at={at} onEdit={onEdit} hover />
      </div>
    );
  return (
    <div className="msg-in group flex gap-3">
      <BotMark />
      <div className="min-w-0 flex-1">
        <p className="mb-0.5 text-xs font-medium text-muted">Hachi</p>
        <div className="prose-reply text-[0.95rem] leading-[1.65]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => <ReplyLink href={href} labelled={labelledLinks(text)}>{children}</ReplyLink>,
              table: ({ children }) => (
                <div className="reply-table">
                  <table>{children}</table>
                </div>
              ),
              pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
              img: ({ src, alt }) =>
                typeof src === "string" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- images from replies, any host
                  <img src={src} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" className="reply-img" />
                ) : null,
            }}
          >
            {text}
          </ReactMarkdown>
        </div>
        <div className="mt-1.5">
          <MessageActions text={text} at={at} />
        </div>
      </div>
    </div>
  );
}

/** "storage.googleapis.com" from a URL, or null if it isn't one. */
function hostOf(href?: string) {
  try {
    return new URL(href ?? "").hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Links in replies. A bare URL becomes a small card (site name + "Open"), so long
 * signed links never spill across the page; a labelled link stays inline.
 */
/** A fenced code block: the language on top, a Copy button, and sideways scrolling. */
function CodeBlock({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const child = Array.isArray(children) ? children[0] : children;
  const cls = (child as { props?: { className?: string } } | undefined)?.props?.className ?? "";
  const lang = /language-([\w+-]+)/.exec(cls)?.[1];
  return (
    <div className="reply-code">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-muted">
        <span className="font-mono">{lang ?? "text"}</span>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 hover:bg-background hover:text-foreground"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(ref.current?.innerText ?? "");
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard blocked */
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

/** URLs the reply already links with a label, like [Open the repo](url). */
function labelledLinks(markdown: string) {
  return new Set([...markdown.matchAll(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]));
}

function ReplyLink({ href, labelled, children }: { href?: string; labelled?: Set<string>; children: React.ReactNode }) {
  const host = hostOf(href);
  const text = typeof children === "string" ? children : Array.isArray(children) ? children.join("") : "";
  const bare = !!host && (text === href || /^https?:\/\//.test(text));
  if (!host) return <span>{children}</span>;
  if (bare && href && labelled?.has(href)) return null; // the same link is already there with a label
  if (!bare)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" title={href} className="reply-link">
        {children}
        <span aria-hidden> ↗</span>
      </a>
    );
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      title={href}
      className="my-0.5 inline-flex max-w-full items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2 align-middle no-underline transition-colors hover:border-accent/50 hover:bg-sunk"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{host}</span>
        <span className="block text-xs text-muted">Open link ↗</span>
      </span>
    </a>
  );
}

/** Time, copy and (for your own messages) edit. Your messages show them on hover. */
function MessageActions({ text, at, onEdit, hover }: { text: string; at: string; onEdit?: () => void; hover?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  }
  return (
    <div
      className={`flex items-center gap-0.5 text-xs text-muted transition-opacity ${
        hover ? "opacity-0 focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100" : ""
      }`}
    >
      <time dateTime={at} title={new Date(at).toLocaleString()} className="mr-1">
        {timeOf(at)}
      </time>
      <IconButton label={copied ? "Copied" : "Copy"} onClick={copy}>
        {copied ? <path d="M5 12l5 5L20 7" /> : <path d="M9 9h10v12H9zM5 15V3h10" />}
      </IconButton>
      {onEdit && (
        <IconButton label="Edit" onClick={onEdit}>
          <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
        </IconButton>
      )}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-6 w-6 place-items-center rounded-md hover:bg-sunk hover:text-foreground pointer-coarse:h-10 pointer-coarse:w-10"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

/** The "it's thinking" line, like other chat apps. */
function Working() {
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <BotMark />
      <span className="shimmer text-sm">Working…</span>
    </div>
  );
}

export function BotMark() {
  return (
    <span className="hidden h-7 w-7 shrink-0 place-items-center rounded-lg bg-foreground text-background sm:grid" title="Hachi">
      <Paw size={15} />
    </span>
  );
}
