"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ApiError, cachedChat, loadChat, post, type ConversationDetail, type TaskStatus } from "@/lib/api";
import { CHAT_RENAMED, refreshChats, useUser } from "./Sidebar";
import { BoxMeadow } from "./ChatScene";
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
    title: "Check a repo's stars",
    prompt: "How many stars does browser-use/browser-use have on GitHub?",
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
  const [error, setError] = useState<{ text: string; secret?: boolean } | null>(null);
  const [liveView, setLiveView] = useState<{ taskId: string; url: string } | null>(null);
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
      loadDetail(activeId).catch(() => setError({ text: "Couldn't load that conversation." }));
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
  const busy = detail?.tasks.some((t) => !["done", "failed", "cancelled"].includes(t.status));

  // Fallback for a dropped live stream: refresh while a task is running.
  useEffect(() => {
    if (!busy || !activeId) return;
    const id = setInterval(() => {
      void loadDetail(activeId).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [busy, activeId, loadDetail]);

  const onLiveView = useCallback((taskId: string, url: string | null) => {
    setLiveView((cur) => (url ? { taskId, url } : cur?.taskId === taskId ? null : cur));
  }, [setLiveView]);

  async function send(e: { preventDefault(): void }) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      let id = activeId;
      if (!id) {
        id = (await post<{ id: string }>("/conversations", {})).id;
        window.history.pushState(null, "", `/chat?c=${id}`); // Next keeps useSearchParams in sync
      }
      await post(`/conversations/${id}/messages`, {
        content,
        client_message_id: crypto.randomUUID(),
      });
      await loadDetail(id);
      setDraft(""); // only now: the message shows in the chat and leaves the box
      refreshChats();
    } catch (err) {      if (err instanceof ApiError && err.code === "secret_in_message") {
        setError({ text: err.message, secret: true });
      } else {
        setError({ text: err instanceof Error ? err.message : "Couldn't send." });
      }
    } finally {
      setSending(false);
    }
  }

  const title = detail?.title;
  // A brand-new chat: the input box sits in the middle of the page, like a home screen.
  // While the first message of a new chat is sending, stay on that screen.
  const firstSend = sending && !detail?.messages.length;
  const empty = firstSend || ((!activeId || (detail !== null && !detail.messages.length)) && !sending);
  // Show "Working…" under the chat while a task runs and isn't waiting on the user.
  const working = busy && !detail?.tasks.some((t) => t.status === "waiting_user");

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
        <div className={`mx-auto ${empty ? "max-w-2xl" : "max-w-3xl"}`}>
          {error && (
            <p className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-danger dark:bg-red-950/50">
              {error.text}
              {!error.secret && (
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={() => {
                    setError(null);
                    refreshChats();
                    if (activeId) void loadDetail(activeId).catch(() => {});
                  }}
                >
                  Try again
                </button>
              )}
              {error.secret && (
                <>
                  {" "}
                  It wasn&apos;t sent or saved. Add it in the{" "}
                  <Link href="/accounts" className="underline">
                    Vault
                  </Link>{" "}
                  instead.
                </>
              )}
            </p>
          )}
          <div data-pet="composer" className={`relative isolate overflow-hidden rounded-2xl border border-border p-3 bg-surface/85 backdrop-blur-md shadow-[0_6px_24px_rgba(0,0,0,0.05)] focus-within:border-foreground/40`}>
            <BoxMeadow />
            <textarea
              ref={input}
              className="block max-h-40 min-h-11 w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted"
              rows={empty ? 3 : 2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(e);
                }
              }}
              placeholder={busy ? "Wait for the current task to finish…" : "Describe what you want done on a website…"}
              readOnly={sending}
              disabled={busy}
              maxLength={4000}
            />
            <div className="mt-1 flex items-center gap-2">
              <Guardrails />
              <button
                aria-label={sending ? "Sending" : "Send"}
                className={`ml-auto grid h-9 w-9 place-items-center rounded-full bg-foreground text-background transition hover:opacity-85 ${
                  sending ? "" : "disabled:opacity-30"
                }`}
                disabled={sending || busy || !draft.trim()}
              >
                {sending ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                ) : (
                  "↑"
                )}
              </button>
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
            <div className="flex items-center gap-3 border-b border-border px-6 py-3.5">
              <h1 className="display truncate text-[1.1rem] leading-tight">{title ?? "New chat"}</h1>
              {busy && (
                <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs text-accent">
                  ● Working
                </span>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-7 sm:px-6">
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
                    I work in a real browser, and keep your logins, codes and keys out of the chat.
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
                      onLiveView={onLiveView}
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

        {live && (
          <aside className="hidden w-[27rem] shrink-0 flex-col border-l border-border bg-sunk xl:flex">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
              <span className="text-sm font-medium">Live browser</span>
              <a href={live.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-muted hover:text-foreground">
                Open in new tab ↗
              </a>
            </div>
            <div className="p-4">
              <iframe
                src={live.url}
                title="Live browser"
                className="aspect-[4/3] w-full rounded-xl border border-border bg-surface"
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
              <p className="mt-3 text-xs text-muted">You can click and type in this browser to help.</p>
            </div>
          </aside>
        )}
      </div>
  );
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
      <div className="group flex flex-col items-end gap-1">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-sm leading-relaxed text-background">
          {text}
        </div>
        <MessageActions text={text} at={at} onEdit={onEdit} hover />
      </div>
    );
  return (
    <div className="group flex gap-3">
      <BotMark />
      <div className="min-w-0 flex-1">
        <div className="prose-reply pt-0.5 text-sm leading-relaxed">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                  {children}
                </a>
              ),
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
        hover ? "opacity-0 focus-within:opacity-100 group-hover:opacity-100" : ""
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
      className="grid h-6 w-6 place-items-center rounded-md hover:bg-sunk hover:text-foreground"
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
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-foreground text-background" title="Hachi">
      <Paw size={15} />
    </span>
  );
}
