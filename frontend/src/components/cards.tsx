import { useEffect, useRef, useState } from "react";

import { LiveView } from "./LiveView";
import { Lock, SecureForm } from "./SecureForm";
import { ApiError, post, type Card } from "@/lib/api";

/** The card a waiting task shows. Secrets go straight to the backend, never into chat. */
export function CardView({ taskId, seq, card }: { taskId: string; seq: number; card: Card }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // A new card needs you: bring it into view and put the keyboard on its first control.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
    // ...unless you're in the middle of typing your next message
    const typing = document.activeElement as HTMLTextAreaElement | null;
    if (typing?.id === "composer" && typing.value.trim()) return;
    const first = el.querySelector<HTMLElement>("input, textarea, button:not([disabled])");
    first?.focus({ preventScroll: true });
  }, [seq]);

  async function submit(fn: () => Promise<unknown>) {
    setState("sending");
    setError(null);
    try {
      await fn();
      setState("sent");
      // answered: back to the message box
      document.getElementById("composer")?.focus({ preventScroll: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send. Try again.");
      setState("idle");
    }
  }

  const input = (kind: string, extra: Record<string, unknown>) =>
    submit(() => post(`/tasks/${taskId}/input`, { card_seq: seq, kind, ...extra }));

  if (state === "sent")
    return (
      <div role="status" className="card flex items-center gap-2 px-4 py-3 text-muted">
        <span className="grid h-4 w-4 place-items-center rounded-full bg-ok text-[9px] text-white">✓</span>
        Sent. Continuing…
      </div>
    );
  const busy = state === "sending";
  const head = HEAD[card.kind] ?? HEAD.question;

  return (
    <div ref={box} role="region" data-card="open" aria-label={card.title ?? "Hachi needs you"} className="card scroll-mb-40">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${head.tone}`}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={head.icon} />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{card.title}</p>
          {card.body && <p className="text-[0.85rem] leading-snug text-muted">{card.body}</p>}
        </div>
        {card.site && (
          <a
            href={`https://${card.site}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost shrink-0 px-2.5 py-1 text-xs"
          >
            Open site ↗
          </a>
        )}
      </div>
      <div className="space-y-3 p-4">

      {card.kind === "question" && <QuestionForm card={card} busy={busy} onAnswer={(text) => input("answer", { data: { text } })} />}

      {card.kind === "confirm" && (
        <div className="space-y-3">
          {(card.site || card.amount) && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-sunk px-3 py-2.5 text-[0.8rem]">
              {card.site && (
                <>
                  <dt className="text-muted">Where</dt>
                  <dd className="font-medium">{card.site}</dd>
                </>
              )}
              {card.amount && (
                <>
                  <dt className="text-muted">Amount</dt>
                  <dd className="font-medium">{card.amount}</dd>
                </>
              )}
            </dl>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy} onClick={() => input("confirm", { data: { decision: "approve" } })}>
              {card.amount ? `Approve · ${card.amount}` : "Approve"}
            </button>
            <button className="btn-ghost" disabled={busy} onClick={() => input("confirm", { data: { decision: "reject" } })}>
              Don&apos;t do it
            </button>
          </div>
          <p className="text-xs text-muted">If you don&apos;t approve, I stop here and nothing is done.</p>
        </div>
      )}

      {card.kind === "otp" && <OtpForm site={card.site} busy={busy} onCode={(code) => input("otp", { secret: code })} />}

      {card.kind === "connect" && (
        <ConnectChoice
          card={card}
          busy={busy}
          onLoggedIn={() => input("credential_ready", { data: {} })}
          onDetails={(secret) =>
            submit(() =>
              post("/vault/credentials", {
                site: card.site,
                kind: "password",
                secret,
                for_task: { task_id: taskId, card_seq: seq },
              }),
            )
          }
        />
      )}

      {card.kind === "secure_input" && (
        <SecureForm
          fields={card.fields ?? []}
          busy={busy}
          onSave={(secret) =>
            submit(() =>
              post("/vault/credentials", {
                site: card.site,
                kind: card.access,
                secret,
                for_task: { task_id: taskId, card_seq: seq },
              }),
            )
          }
        />
      )}

      {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </div>
  );
}

// One tile style for every card: a line icon on a soft fill. Approvals are amber.
const HEAD: Record<string, { icon: string; tone: string }> = {
  question: { icon: "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", tone: "bg-accent-soft text-accent" },
  confirm: { icon: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM9 12l2 2 4-4", tone: "bg-warn-soft text-warn" },
  otp: { icon: "M4 9h16M4 15h16M10 3 8 21M16 3l-2 18", tone: "bg-accent-soft text-accent" },
  connect: { icon: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3", tone: "bg-accent-soft text-accent" },
  secure_input: { icon: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z", tone: "bg-accent-soft text-accent" },
};


/** Two ways to connect: log in yourself in the live browser, or give login details. */
function ConnectChoice({
  card,
  busy,
  onLoggedIn,
  onDetails,
}: {
  card: Card;
  busy: boolean;
  onLoggedIn: () => void;
  onDetails: (secret: Record<string, string>) => void;
}) {
  const [mode, setMode] = useState<"self" | "details">("self");
  const tile = (m: typeof mode, label: string, hint: string) => (
    <button
      type="button"
      className={`flex flex-col items-start rounded-xl border px-3 py-2.5 text-left transition ${
        mode === m ? "border-accent bg-accent-soft" : "border-border hover:border-foreground"
      }`}
      onClick={() => setMode(m)}
    >
      <span className="font-medium">{label}</span>
      <span className="text-xs text-muted">{hint}</span>
    </button>
  );
  return (
    <div className="space-y-3">
      {!!card.fields?.length && (
        <div className="grid gap-2 sm:grid-cols-2">
          {tile("self", "Log in myself", "In the live browser")}
          {tile("details", "Give my login details", "Phone or email; I'll ask for codes")}
        </div>
      )}
      {mode === "self" ? (
        <>
          {card.live_view_url ? (
            <LiveView url={card.live_view_url} title={`Log in to ${card.site}`} />
          ) : (
            <p className="rounded-lg bg-sunk px-3 py-2 text-xs">
              A browser window opened for you. Log in to {card.site} there, then come back and click
              Done. Hachi never sees what you type.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" disabled={busy} onClick={onLoggedIn}>
              Done, I&apos;m logged in
            </button>
            <Lock>Only the login is kept, encrypted in your Vault, for {card.site}. Remove it anytime.</Lock>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-muted">
            I&apos;ll log in for you. If {card.site} texts or emails you a code, I&apos;ll ask for it here.
          </p>
          <SecureForm
            fields={card.fields ?? []}
            busy={busy}
            onSave={onDetails}
            submitLabel="Save and log in"
            note={`Encrypted and kept in your Vault, used only on ${card.site}. Never shown in chat or to the AI. Remove it anytime.`}
          />
        </>
      )}
    </div>
  );
}

function QuestionForm({ card, busy, onAnswer }: { card: Card; busy: boolean; onAnswer: (t: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="space-y-2">
      {!!card.choices?.length && (
        <div className="flex flex-wrap gap-2">
          {card.choices.map((c) => (
            <button key={c} className="btn-ghost" disabled={busy} onClick={() => onAnswer(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onAnswer(text.trim());
        }}
      >
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type an answer" />
        <button className="btn-primary" disabled={busy || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

function OtpForm({ site, busy, onCode }: { site?: string; busy: boolean; onCode: (c: string) => void }) {
  const [code, setCode] = useState("");
  return (
    <form
      className="flex flex-wrap items-center gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onCode(code);
      }}
    >
      <input
        className="input max-w-44 py-2.5 text-center font-mono text-lg tracking-[0.4em]"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{4,8}"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
        placeholder="123456"
      />
      <button className="btn-primary" disabled={busy || code.length < 4}>
        Submit code
      </button>
      <Lock>Used once{site ? ` on ${site}` : ""}, then deleted. Never shown in chat or to the AI.</Lock>
    </form>
  );
}

