"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ApiError, api, post, type ConversationDetail, type TaskStatus } from "@/lib/api";
import { refreshChats } from "./Sidebar";
import { TaskView } from "./TaskView";

const EXAMPLES = [
  "How many stars does browser-use/browser-use have on GitHub?",
  "Star the repo browser-use/browser-use",
  "Ask a free model on OpenRouter to write a haiku",
];

export function ChatApp() {
  // The open chat lives in the URL (?c=), so sidebar links and back/forward just work.
  const activeId = useSearchParams().get("c");
  const [loaded, setLoaded] = useState<ConversationDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<string | null>(null); // shown right away while sending
  const [error, setError] = useState<{ text: string; secret?: boolean } | null>(null);
  const [liveView, setLiveView] = useState<{ taskId: string; url: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // Only show what belongs to the open chat (the previous one may still be in state).
  const detail = loaded?.id === activeId ? loaded : null;
  const live = liveView && detail?.tasks.some((t) => t.id === liveView.taskId) ? liveView : null;

  const loadDetail = useCallback(
    (id: string) => api<ConversationDetail>(`/conversations/${id}`).then(setLoaded),
    [],
  );

  useEffect(() => {
    if (activeId) {
      loadDetail(activeId).catch(() => setError({ text: "Couldn't load that conversation." }));
    }
  }, [activeId, loadDetail]);

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
  }, []);

  async function send(e: { preventDefault(): void }) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    setPending(content);
    setDraft("");
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
      refreshChats();
    } catch (err) {
      setDraft(content); // give the text back so nothing is lost
      if (err instanceof ApiError && err.code === "secret_in_message") {
        setError({ text: err.message, secret: true });
      } else {
        setError({ text: err instanceof Error ? err.message : "Couldn't send." });
      }
    } finally {
      setPending(null);
      setSending(false);
    }
  }

  const title = detail?.title;

  return (
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
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
              {activeId && !detail && !pending && (
                <div className="flex flex-col gap-4 pt-2">
                  <span className="h-10 w-1/2 self-end animate-pulse rounded-2xl bg-sunk" />
                  <span className="ml-10 h-12 animate-pulse rounded-2xl bg-sunk" />
                  <span className="ml-10 h-4 w-2/3 animate-pulse rounded bg-sunk" />
                </div>
              )}
              {(!activeId || (detail && !detail.messages.length)) && !pending && (
                <div className="mt-[12vh] text-center">
                  <h1 className="display text-4xl">What should I do?</h1>
                  <p className="mt-3 text-sm text-muted">
                    I work in a real browser, and keep your logins, codes and keys out of the chat.
                  </p>
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    {EXAMPLES.map((ex) => (
                      <button
                        key={ex}
                        className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:border-foreground hover:text-foreground"
                        onClick={() => setDraft(ex)}
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {detail?.messages.map((m) => (
                <div key={m.id} className="flex flex-col gap-3">
                  <Bubble role={m.role} text={m.content} />
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
              {pending && (
                <div className="flex flex-col gap-3">
                  <Bubble role="user" text={pending} pending />
                  <p className="ml-10 text-sm text-muted">Sending…</p>
                </div>
              )}
              <div ref={bottom} />
            </div>
          </div>

          <form onSubmit={send} className="px-4 pb-5 pt-2 sm:px-6">
            <div className="mx-auto max-w-3xl">
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
              <div className="rounded-2xl border border-border bg-surface p-3 shadow-[0_6px_24px_rgba(0,0,0,0.05)] focus-within:border-foreground/40">
                <textarea
                  className="block max-h-40 min-h-11 w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted"
                  rows={2}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(e);
                    }
                  }}
                  placeholder={busy ? "Wait for the current task to finish…" : "Describe what you want done on a website…"}
                  disabled={sending || busy}
                  maxLength={4000}
                />
                <div className="mt-1 flex items-center gap-2">
                  <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">$1 limit per task</span>
                  <span className="hidden rounded-full border border-border px-2.5 py-0.5 text-xs text-muted sm:inline">
                    Asks before paying
                  </span>
                  <button
                    aria-label="Send"
                    className="ml-auto grid h-9 w-9 place-items-center rounded-full bg-foreground text-background transition hover:opacity-85 disabled:opacity-30"
                    disabled={sending || busy || !draft.trim()}
                  >
                    ↑
                  </button>
                </div>
              </div>
              <p className="mt-2 text-center text-xs text-muted">
                Never type passwords, codes or keys here. I&apos;ll ask for them with a secure form.
              </p>
            </div>
          </form>
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

function Bubble({ role, text, pending }: { role: string; text: string; pending?: boolean }) {
  if (role === "user")
    return (
      <div className="flex justify-end">
        <div
          className={`max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-sm leading-relaxed text-background ${
            pending ? "opacity-60" : ""
          }`}
        >
          {text}
        </div>
      </div>
    );
  return (
    <div className="flex gap-3">
      <BotMark />
      <div className="prose-reply min-w-0 flex-1 pt-0.5 text-sm leading-relaxed">
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
    </div>
  );
}

export function BotMark() {
  return (
    <span className="display grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-foreground text-base text-background">
      B
    </span>
  );
}
