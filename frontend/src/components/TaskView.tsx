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

// Older tasks stored technical step text; show it in plain words.
function friendly(text: string): string {
  const api = /^Calling the (\S+) API: (\w+) /.exec(text);
  if (api) return `${api[2].toUpperCase() === "GET" ? "Looking things up" : "Making the change"} on ${api[1]}`;
  return text.replace(/^\S+ · step \d+: /, "");
}

const SHOWN_STEPS = 4; // the rest sit behind "Show all"

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
  onLiveView,
}: {
  taskId: string;
  initialStatus: TaskStatus;
  onFinished: () => void;
  onLiveView?: (taskId: string, url: string | null) => void;
}) {
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [open, setOpen] = useState(!TERMINAL.includes(initialStatus));
  const [stream, setStream] = useState(0); // bumped to reconnect after a resume
  const [allSteps, setAllSteps] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const retryInFlight = useRef(false);
  const lastSeq = useRef(0);
  const finished = useRef(onFinished);
  useEffect(() => {
    finished.current = onFinished;
  });

  // A task that was already finished when the chat opened replays its history. That
  // replay passes through "running" and the live-view link, which must not show
  // (it made the live panel blink in and out) or count as the task finishing now.
  const [finishedOnOpen, setFinishedOnOpen] = useState(() => TERMINAL.includes(initialStatus));

  useEffect(() => {
    let sawLive = false;
    const resumed = lastSeq.current > 0; // reconnecting after Resume: the end must refresh the chat
    const history = finishedOnOpen;
    const stop = streamTask(taskId, lastSeq.current, (event) => {
      lastSeq.current = Math.max(lastSeq.current, event.seq);
      // Ignore duplicates (reconnects can overlap).
      setEvents((prev) => (prev.some((e) => e.seq === event.seq) ? prev : [...prev, event]));
      if (event.type === "status") {
        const status = event.data.status as TaskStatus;
        if (!TERMINAL.includes(status)) sawLive = !history;
        else if (sawLive || resumed) finished.current(); // it finished while we watched
      }
    });
    return stop;
  }, [taskId, stream, finishedOnOpen]);

  const view = useMemo(() => {
    let status: TaskStatus = initialStatus;
    let liveView: string | null = null;
    let error: TaskError | null = null;
    const steps: string[] = [];
    const resolved = new Set<number>();
    const cards: { seq: number; card: Card }[] = [];
    for (const e of events) {
      if (e.type === "status") {
        if (finishedOnOpen) continue; // keep showing the final status during the replay
        status = e.data.status as TaskStatus;
        if (!TERMINAL.includes(status)) error = null; // resumed
      }
      else if (e.type === "progress") steps.push(friendly(String(e.data.text)));
      else if (e.type === "card") cards.push({ seq: e.seq, card: e.data as unknown as Card });
      else if (e.type === "card_resolved") resolved.add(Number(e.data.card_seq));
      else if (e.type === "live_view") liveView = finishedOnOpen ? null : ((e.data.url as string) ?? null);
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
  }, [events, initialStatus, finishedOnOpen]);

  const done = TERMINAL.includes(view.status);
  const liveUrl = view.liveView && !done ? view.liveView : null;
  useEffect(() => {
    onLiveView?.(taskId, liveUrl);
  }, [onLiveView, taskId, liveUrl]);
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
        setFinishedOnOpen(false); // live again: show its status and live view
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
          ? "text-warn"
          : "text-accent";

  return (
    <div className="ml-10 flex flex-col gap-3 text-sm">
      <div className="card">
        <button
          className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left"
          onClick={() => setOpen((o) => !o)}
        >
          <StepIcon state={done ? (view.status === "done" ? "ok" : "bad") : view.status === "waiting_user" ? "wait" : "run"} />
          <span className={`font-medium ${tone}`}>{STATUS_LABEL[view.status]}</span>
          <span className="truncate text-muted">{view.steps.at(-1)}</span>
          <span className="ml-auto shrink-0 text-xs text-muted">
            {view.steps.length} step{view.steps.length === 1 ? "" : "s"} {open ? "▴" : "▾"}
          </span>
        </button>

        {open && view.steps.length > 0 && (
          <ol className="flex flex-col gap-1.5 border-t border-border px-4 py-3">
            {view.steps.length > SHOWN_STEPS && !allSteps && (
              <li>
                <button className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline" onClick={() => setAllSteps(true)}>
                  Show all {view.steps.length} steps
                </button>
              </li>
            )}
            {view.steps.map((s, i) => {
              if (!allSteps && i < view.steps.length - SHOWN_STEPS) return null;
              const last = i === view.steps.length - 1;
              const running = last && !done && view.status !== "waiting_user";
              return (
                <li key={i} className={`flex gap-2.5 ${running ? "text-foreground" : "text-muted"}`}>
                  <StepIcon state={running ? "run" : "ok"} small />
                  <span className="line-clamp-2 min-w-0 break-words">{s}</span>
                </li>
              );
            })}
          </ol>
        )}

        {/* Narrow screens: live view inline. Wide screens show it in the side panel. */}
        {liveUrl && (
          <div className="border-t border-border p-3 xl:hidden">
            <iframe
              src={liveUrl}
              title="Live browser"
              className="aspect-video w-full rounded-lg border border-border"
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
        )}

        {view.error && view.status === "failed" && (
          <p className="border-t border-border px-4 py-2.5 text-danger">{view.error.message}</p>
        )}

        {(canResume || canRestart) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
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

      {view.activeCard && (
        <CardView taskId={taskId} seq={view.activeCard.seq} card={view.activeCard.card} />
      )}
    </div>
  );
}

function StepIcon({ state, small }: { state: "ok" | "run" | "bad" | "wait"; small?: boolean }) {
  const size = small ? "mt-0.5 h-4 w-4 text-[9px]" : "h-[1.1rem] w-[1.1rem] text-[10px]";
  if (state === "wait")
    return <span className={`${size} grid shrink-0 place-items-center rounded-full bg-warn text-white`}>…</span>;
  if (state === "run")
    return <span className={`${size} shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent`} />;
  return (
    <span
      className={`${size} grid shrink-0 place-items-center rounded-full text-white ${
        state === "ok" ? "bg-ok" : "bg-danger"
      }`}
    >
      {state === "ok" ? "✓" : "!"}
    </span>
  );
}
