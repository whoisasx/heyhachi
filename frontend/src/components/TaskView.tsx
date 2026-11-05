import { useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  TERMINAL,
  post,
  streamTask,
  type Card,
  type TaskEvent,
  type TaskStatus,
} from "@/lib/api";
import { CardView } from "./cards";

// Limits and repeated crashes would hit the same wall again: only "Start over".
const RESTART_ONLY = ["step_limit", "time_limit", "cost_limit", "too_many_attempts"];

interface TaskError {
  code: string;
  message: string;
  retryable: boolean;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: "Starting",
  running: "Working",
  waiting_user: "Needs you",
  verifying: "Checking",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function TaskView({
  taskId,
  initialStatus,
  onFinished,
}: {
  taskId: string;
  initialStatus: TaskStatus;
  onFinished: () => void;
}) {
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [open, setOpen] = useState(!TERMINAL.includes(initialStatus));
  const [stream, setStream] = useState(0); // bumped to reconnect after a resume
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const retryInFlight = useRef(false);
  const lastSeq = useRef(0);
  const finished = useRef(onFinished);
  useEffect(() => {
    finished.current = onFinished;
  });

  useEffect(() => {
    let sawLive = false;
    const resumed = lastSeq.current > 0; // reconnecting after Resume: the end must refresh the chat
    const stop = streamTask(taskId, lastSeq.current, (event) => {
      lastSeq.current = Math.max(lastSeq.current, event.seq);
      // Ignore duplicates (reconnects can overlap).
      setEvents((prev) => (prev.some((e) => e.seq === event.seq) ? prev : [...prev, event]));
      if (event.type === "status") {
        const status = event.data.status as TaskStatus;
        if (!TERMINAL.includes(status)) sawLive = true;
        else if (sawLive || resumed) finished.current(); // it finished while we watched
      }
    });
    return stop;
  }, [taskId, stream]);

  const view = useMemo(() => {
    let status: TaskStatus = initialStatus;
    let liveView: string | null = null;
    let error: TaskError | null = null;
    const steps: string[] = [];
    const resolved = new Set<number>();
    const cards: { seq: number; card: Card }[] = [];
    for (const e of events) {
      if (e.type === "status") {
        status = e.data.status as TaskStatus;
        if (!TERMINAL.includes(status)) error = null; // resumed
      }
      else if (e.type === "progress") steps.push(String(e.data.text));
      else if (e.type === "card") cards.push({ seq: e.seq, card: e.data as unknown as Card });
      else if (e.type === "card_resolved") resolved.add(Number(e.data.card_seq));
      else if (e.type === "live_view") liveView = (e.data.url as string) ?? null;
      else if (e.type === "error")
        error = {
          code: String(e.data.code ?? "internal_error"),
          message: String(e.data.message ?? "Something went wrong."),
          retryable: Boolean(e.data.retryable),
        };
    }
    const pending = [...cards].reverse().find((c) => !resolved.has(c.seq));
    const activeCard = status === "waiting_user" ? pending : undefined;
    return { status, steps, activeCard, liveView, error };
  }, [events, initialStatus]);

  const done = TERMINAL.includes(view.status);
  const canRestart =
    (view.status === "failed" && view.error?.retryable) || view.status === "cancelled";
  const canResume =
    view.status === "failed" && view.error?.retryable && !RESTART_ONLY.includes(view.error.code);

  async function retry(mode: "resume" | "restart") {
    if (retryInFlight.current) return; // a fast double click would send two requests
    retryInFlight.current = true;
    setRetrying(true);
    setRetryError(null);
    try {
      await post(`/tasks/${taskId}/retry`, { mode });
      if (mode === "resume") {
        setOpen(true);
        setStream((n) => n + 1); // same task: listen again from the last event
        finished.current(); // refresh the chat so it knows a task is running again
      } else {
        finished.current(); // new task: the chat reloads and shows it
      }
    } catch (err) {
      setRetryError(err instanceof ApiError ? err.message : "Couldn't retry.");
    } finally {
      retryInFlight.current = false;
      setRetrying(false);
    }
  }
  const tone =
    view.status === "failed"
      ? "text-danger"
      : view.status === "done"
        ? "text-ok"
        : view.status === "waiting_user"
          ? "text-amber-600"
          : "text-accent";

  return (
    <div className="ml-2 rounded-xl border border-border bg-surface/60 text-sm">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        {!done && <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />}
        <span className={`font-medium ${tone}`}>{STATUS_LABEL[view.status]}</span>
        <span className="truncate text-muted">{view.steps.at(-1)}</span>
        <span className="ml-auto text-xs text-muted">
          {view.steps.length} step{view.steps.length === 1 ? "" : "s"} {open ? "▴" : "▾"}
        </span>
      </button>

      {open && view.steps.length > 0 && (
        <ol className="space-y-1 border-t border-border px-3 py-2 text-muted">
          {view.steps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-xs tabular-nums opacity-60">{i + 1}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      )}

      {view.liveView && !done && (
        <div className="border-t border-border p-3">
          <iframe
            src={view.liveView}
            title="Live browser"
            className="aspect-video w-full rounded-lg border border-border"
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      )}

      {view.activeCard && (
        <div className="border-t border-border p-3">
          <CardView taskId={taskId} seq={view.activeCard.seq} card={view.activeCard.card} />
        </div>
      )}

      {view.error && view.status === "failed" && (
        <p className="border-t border-border px-3 py-2 text-danger">{view.error.message}</p>
      )}

      {(canResume || canRestart) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
          {canResume && (
            <button className="btn-primary py-1.5" disabled={retrying} onClick={() => retry("resume")}>
              Resume
            </button>
          )}
          {canRestart && (
            <button className="btn-ghost py-1.5" disabled={retrying} onClick={() => retry("restart")}>
              Start over
            </button>
          )}
          {retryError && done && <span className="text-xs text-danger">{retryError}</span>}
        </div>
      )}
    </div>
  );
}
