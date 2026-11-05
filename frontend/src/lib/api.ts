"use client";

import { fetchEventSource } from "@microsoft/fetch-event-source";

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";
const API = `${BACKEND_URL}/v1`;

// ---- token ---------------------------------------------------------------------

let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;

/** Backend token from our own Next.js route, refreshed a minute before it expires. */
export async function getToken(): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
  inflight ??= fetch("/api/backend-token", { cache: "no-store", signal: AbortSignal.timeout(15_000) })
    .then(async (res) => {
      if (!res.ok) throw new ApiError(res.status, "unauthenticated", "Please sign in again.");
      const body = await res.json();
      cached = { token: body.token, expiresAt: body.expires_at };
      return body.token as string;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// ---- requests ------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Requests that hang (flaky networks) fail after this instead of spinning forever. */
const REQUEST_TIMEOUT_MS = 20_000;

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...init,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new ApiError(res.status, err.code ?? "error", err.message ?? "Something went wrong.");
  }
  return body as T;
}

export const post = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });

// ---- chat cache ----------------------------------------------------------------

// Chats seen this session show instantly while a fresh copy loads in the background.
const chatCache = new Map<string, ConversationDetail>();
const chatInflight = new Map<string, Promise<ConversationDetail>>();

export const cachedChat = (id: string) => chatCache.get(id) ?? null;

/** Loads a chat (shared by the chat page and the sidebar's hover prefetch). */
export function loadChat(id: string): Promise<ConversationDetail> {
  let p = chatInflight.get(id);
  if (!p) {
    p = api<ConversationDetail>(`/conversations/${id}`)
      .then((d) => {
        chatCache.set(id, d);
        return d;
      })
      .finally(() => chatInflight.delete(id));
    chatInflight.set(id, p);
  }
  return p;
}

// ---- types ---------------------------------------------------------------------

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting_user"
  | "verifying"
  | "done"
  | "failed"
  | "cancelled";

export const TERMINAL: TaskStatus[] = ["done", "failed", "cancelled"];

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  task_id: string | null;
  created_at: string;
}

export interface TaskBrief {
  id: string;
  status: TaskStatus;
}

export interface Conversation {
  id: string;
  title: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ConversationDetail {
  id: string;
  title: string | null;
  messages: Message[];
  tasks: TaskBrief[];
}

export interface Field {
  name: string;
  type: string;
  label?: string;
  length?: number;
  optional?: boolean;
}

export interface Card {
  kind: "otp" | "confirm" | "question" | "connect" | "secure_input" | "credential";
  site?: string;
  title?: string;
  body?: string;
  choices?: string[];
  fields?: Field[];
  access?: string;
  live_view_url?: string | null;
}

export interface TaskEvent {
  seq: number;
  type: string;
  data: Record<string, unknown>;
}

// ---- live events -----------------------------------------------------------------

/** Stream a task's events (replays from `afterSeq`). Returns a stop function. */
export function streamTask(
  taskId: string,
  afterSeq: number,
  onEvent: (event: TaskEvent) => void,
): () => void {
  const controller = new AbortController();
  let lastSeq = afterSeq;
  let ended = false; // saw the final status: the server's close is expected

  const run = async () => {
    for (let attempt = 0; !controller.signal.aborted && attempt < 20; attempt++) {
      try {
        const token = await getToken();
        if (controller.signal.aborted) return; // stopped while fetching the token
        await fetchEventSource(`${API}/tasks/${taskId}/events`, {
          signal: controller.signal,
          openWhenHidden: true,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(lastSeq ? { "Last-Event-ID": String(lastSeq) } : {}),
          },
          onmessage(msg) {
            if (!msg.event || !msg.id) return; // pings
            const seq = Number(msg.id);
            if (seq <= lastSeq) return;
            lastSeq = seq;
            const data = msg.data ? JSON.parse(msg.data) : {};
            // A resumed task has a "failed" in its history, so only the latest status counts.
            if (msg.event === "status") ended = TERMINAL.includes(data.status);
            onEvent({ seq, type: msg.event, data });
          },
          onclose() {
            if (ended) throw new StreamClosed();
            throw new Error("stream dropped"); // reconnect and resume from lastSeq
          },
          onerror(err) {
            throw err; // handled below: reconnect with backoff
          },
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof StreamClosed) return; // server closes after the task ends
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 10_000)));
      }
    }
  };
  void run();
  return () => controller.abort();
}

class StreamClosed extends Error {}
