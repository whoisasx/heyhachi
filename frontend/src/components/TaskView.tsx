import { useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  TERMINAL,
  post,
  streamTask,
  type Card,
  type TaskBrief,
  type TaskEvent,
  type TaskStatus,
} from "@/lib/api";
import { CardView } from "./cards";
import { LiveView } from "./LiveView";

// Limits and repeated crashes would hit the same wall again: only "Start over".
const RESTART_ONLY = ["step_limit", "time_limit", "cost_limit", "too_many_attempts"];

interface TaskError {
  code: string;
  message: string;
  retryable: boolean;
}

// What went wrong, in plain words, and what to do next.
const NEXT_STEP: Record<string, string> = {
  step_limit: "It needed more steps than a task is allowed. Start over with a more specific request.",
  time_limit: "It ran past the time limit for one task. Start over, maybe with a smaller request.",
  cost_limit: "It reached the $1 spending limit for one task. Start over with a narrower request.",
  too_many_attempts: "It failed several times in a row. Try again in a while, or rephrase the request.",
  waiting_timeout: "I waited too long for your answer. Resume to pick up where I left off.",
  access_revoked: "Access to the site was removed. Reconnect it in the Vault, then start over.",
  internal_error: "Resume to try again from the last step, or start over.",
};

/** "38s", "4m 12s" */
function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
const money = (usd: number) => (usd < 0.01 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`);

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
  onStatus,
  brief,
  latest = true,
}: {
  taskId: string;
  initialStatus: TaskStatus;
  onFinished: () => void;
  brief?: TaskBrief; // cost and timing, from the chat
  latest?: boolean; // only the newest task in a chat offers Resume / Start over
  onLiveView?: (taskId: string, url: string | null, site?: string) => void;
  onStatus?: (taskId: string, status: TaskStatus) => void;
}) {
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [open, setOpen] = useState(!TERMINAL.includes(initialStatus));
  const [stream, setStream] = useState(0); // bumped to reconnect after a resume
  const [allSteps, setAllSteps] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [showLive, setShowLive] = useState(false);
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
    let liveSite: string | undefined;
    let error: TaskError | null = null;
    const steps: string[] = [];
    const resolved = new Map<number, string>(); // card seq -> what you answered
    const cards: { seq: number; card: Card }[] = [];
    for (const e of events) {
      if (e.type === "status") {
        if (finishedOnOpen) continue; // keep showing the final status during the replay
        status = e.data.status as TaskStatus;
        if (!TERMINAL.includes(status)) error = null; // resumed
      }
      else if (e.type === "progress") steps.push(friendly(String(e.data.text)));
      else if (e.type === "card") cards.push({ seq: e.seq, card: e.data as unknown as Card });
      else if (e.type === "card_resolved")
        resolved.set(
          Number(e.data.card_seq),
          e.data.answer
            ? String(e.data.answer)
            : e.data.outcome === "submitted"
              ? "Answered"
              : e.data.outcome === "expired"
                ? "No answer in time"
                : "Skipped",
        );
      else if (e.type === "live_view") {
        liveView = finishedOnOpen ? null : ((e.data.url as string) ?? null);
        liveSite = e.data.site ? String(e.data.site) : undefined;
      }
      else if (e.type === "error")
        error = {
          code: String(e.data.code ?? "internal_error"),
          message: String(e.data.message ?? "Something went wrong."),
          retryable: Boolean(e.data.retryable),
        };
    }
    const pending = [...cards].reverse().find((c) => !resolved.has(c.seq));
    const activeCard = status === "waiting_user" ? pending : undefined;
    const answered = cards
      .filter((c) => resolved.has(c.seq))
      .map((c) => ({ seq: c.seq, title: c.card.title ?? "Question", answer: resolved.get(c.seq)! }));
    return { status, steps, activeCard, answered, liveView, liveSite, error };
  }, [events, initialStatus, finishedOnOpen]);

  useEffect(() => {
    onStatus?.(taskId, view.status);
  }, [onStatus, taskId, view.status]);

  const done = TERMINAL.includes(view.status);
  const liveUrl = view.liveView && !done ? view.liveView : null;
  useEffect(() => {
    onLiveView?.(taskId, liveUrl, view.liveSite);
  }, [onLiveView, taskId, liveUrl, view.liveSite]);
  const canRestart =
    latest && ((view.status === "failed" && view.error?.retryable) || view.status === "cancelled");
  const canResume =
    latest && view.status === "failed" && view.error?.retryable && !RESTART_ONLY.includes(view.error.code);

  // Time spent: ticks while running, fixed once finished.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (done || !brief?.started_at) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [done, brief?.started_at]);
  const started = brief?.started_at ? Date.parse(brief.started_at) : null;
  const ended = brief?.finished_at ? Date.parse(brief.finished_at) : done ? null : now;
  const took = started && ended ? duration(ended - started) : null;
  const facts = [
    `${view.steps.length} step${view.steps.length === 1 ? "" : "s"}`,
    took,
    done && brief?.cost_usd ? money(brief.cost_usd) : null,
  ].filter(Boolean);

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
    <div className="flex flex-col gap-3 text-sm sm:ml-10">
      <div className="card">
        <button
          className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`${STATUS_LABEL[view.status]}: ${view.steps.at(-1) ?? ""}. ${open ? "Hide" : "Show"} ${view.steps.length} steps`}
        >
          <StepIcon state={done ? (view.status === "done" ? "ok" : "bad") : view.status === "waiting_user" ? "wait" : "run"} />
          <span className={`font-medium ${tone}`}>{STATUS_LABEL[view.status]}</span>
          <span className="truncate text-muted">{view.steps.at(-1)}</span>
          <span
            className="ml-auto shrink-0 text-xs text-muted"
            title={done ? "Steps, time taken and what it cost (AI + browser)" : undefined}
          >
            {facts.join(" · ")} {open ? "▴" : "▾"}
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

        {/* Narrow screens: live view inline (folded while a card needs you). Wide screens use the side panel. */}
        {liveUrl && (
          <div className="border-t border-border p-3 xl:hidden">
            {view.activeCard && !showLive ? (
              <button
                className="flex w-full items-center gap-2 text-xs text-muted hover:text-foreground"
                onClick={() => setShowLive(true)}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                Live browser{view.liveSite ? ` · ${view.liveSite}` : ""}
                <span className="ml-auto underline underline-offset-2">Show</span>
              </button>
            ) : (
              <LiveView url={liveUrl} title={`Hachi is browsing${view.liveSite ? ` ${view.liveSite}` : ""}`} />
            )}
          </div>
        )}

        {view.error && view.status === "failed" && (
          <div role="alert" className="border-t border-border px-4 py-2.5">
            <p className="text-danger">{view.error.message}</p>
            {latest && NEXT_STEP[view.error.code] && (
              <p className="mt-0.5 text-xs text-muted">{NEXT_STEP[view.error.code]}</p>
            )}
          </div>
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

      {view.answered.map((a) => (
        <p key={a.seq} className="flex items-center gap-2 px-1 text-xs text-muted">
          <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-sunk text-[9px]" aria-hidden>
            ↳
          </span>
          <span className="min-w-0 truncate">
            {a.title}: <span className="font-medium text-foreground">{a.answer}</span>
          </span>
        </p>
      ))}

      {view.activeCard && (
        <CardView key={view.activeCard.seq} taskId={taskId} seq={view.activeCard.seq} card={view.activeCard.card} />
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
