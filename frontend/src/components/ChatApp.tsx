"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ApiError, api, post, type ConversationDetail, type TaskStatus } from "@/lib/api";
import { TaskView } from "./TaskView";

interface Summary {
  id: string;
  title: string | null;
  updated_at: string;
  active_task_id: string | null;
}

export function ChatApp({ initialId }: { initialId: string | null }) {
  const [conversations, setConversations] = useState<Summary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialId);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<string | null>(null); // shown right away while sending
  const [error, setError] = useState<{ text: string; secret?: boolean } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const loadList = useCallback(
    () =>
      api<{ items: Summary[] }>("/conversations?limit=50").then((list) =>
        setConversations(list.items),
      ),
    [],
  );

  const loadDetail = useCallback(
    (id: string) => api<ConversationDetail>(`/conversations/${id}`).then(setDetail),
    [],
  );

  useEffect(() => {
    loadList().catch(() => setError({ text: "Couldn't reach the server." }));
  }, [loadList]);

  useEffect(() => {
    window.history.replaceState(null, "", activeId ? `/chat?c=${activeId}` : "/chat");
    if (activeId) {
      loadDetail(activeId).catch(() => setError({ text: "Couldn't load that conversation." }));
    }
  }, [activeId, loadDetail]);

  function open(id: string | null) {
    if (id !== activeId) setDetail(null);
    setActiveId(id);
  }

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
        setActiveId(id);
      }
      await post(`/conversations/${id}/messages`, {
        content,
        client_message_id: crypto.randomUUID(),
      });
      await Promise.all([loadDetail(id), loadList()]);
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

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="p-3">
          <button className="btn-ghost w-full" onClick={() => open(null)}>
            + New chat
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto px-2 pb-3">
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => open(c.id)}
                className={`w-full truncate rounded-md px-3 py-2 text-left text-sm ${
                  c.id === activeId ? "bg-accent-soft text-accent" : "hover:bg-accent-soft/50"
                }`}
              >
                {c.active_task_id && <span className="mr-1 text-accent">●</span>}
                {c.title ?? "New chat"}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
            {!detail?.messages.length && !pending && (
              <div className="mt-16 text-center text-muted">
                <p className="text-lg font-medium text-foreground">What should I do?</p>
                <p className="mt-2 text-sm">
                  e.g. &ldquo;Star the repo browser-use/browser-use on GitHub&rdquo; or &ldquo;How
                  many stars does it have?&rdquo;
                </p>
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
                    onFinished={() => {
                      if (activeId) void loadDetail(activeId);
                      void loadList();
                    }}
                  />
                )}
              </div>
            ))}
            {pending && (
              <div className="flex flex-col gap-3">
                <Bubble role="user" text={pending} pending />
                <p className="ml-2 text-sm text-muted">Sending…</p>
              </div>
            )}
            <div ref={bottom} />
          </div>
        </div>

        <div className="border-t border-border bg-surface">
          <form onSubmit={send} className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3">
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger dark:bg-red-950">
                {error.text}
                {!error.secret && (
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => {
                      setError(null);
                      void loadList().catch(() => setError({ text: "Couldn't reach the server." }));
                      if (activeId) void loadDetail(activeId).catch(() => {});
                    }}
                  >
                    Try again
                  </button>
                )}
                {error.secret && (
                  <>
                    {" "}
                    It wasn&apos;t sent or saved. Add it in{" "}
                    <Link href="/accounts" className="underline">
                      Connected accounts
                    </Link>{" "}
                    instead.
                  </>
                )}
              </p>
            )}
            <div className="flex gap-2">
              <input
                className="input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={busy ? "Wait for the current task to finish…" : "Ask me to do something…"}
                disabled={sending || busy}
                maxLength={4000}
              />
              <button className="btn-primary" disabled={sending || busy || !draft.trim()}>
                Send
              </button>
            </div>
            <p className="text-xs text-muted">
              Never type passwords, codes or keys here. I&apos;ll ask for them with a secure form.
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}

function Bubble({ role, text, pending }: { role: string; text: string; pending?: boolean }) {
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          mine ? "whitespace-pre-wrap bg-accent text-white" : "prose-reply border border-border bg-surface"
        } ${pending ? "opacity-60" : ""}`}
      >
        {mine ? (
          text
        ) : (
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
        )}
      </div>
    </div>
  );
}
