import { useState, type ReactNode } from "react";

import { ApiError, post, type Card, type Field } from "@/lib/api";

/** The card a waiting task shows. Secrets go straight to the backend, never into chat. */
export function CardView({ taskId, seq, card }: { taskId: string; seq: number; card: Card }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(fn: () => Promise<unknown>) {
    setState("sending");
    setError(null);
    try {
      await fn();
      setState("sent");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send. Try again.");
      setState("idle");
    }
  }

  const input = (kind: string, extra: Record<string, unknown>) =>
    submit(() => post(`/tasks/${taskId}/input`, { card_seq: seq, kind, ...extra }));

  if (state === "sent")
    return (
      <div className="card flex items-center gap-2 px-4 py-3 text-muted">
        <span className="grid h-4 w-4 place-items-center rounded-full bg-ok text-[9px] text-white">✓</span>
        Sent. Continuing…
      </div>
    );
  const busy = state === "sending";
  const head = HEAD[card.kind] ?? HEAD.question;

  return (
    <div className="card">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-semibold ${head.tone}`}>
          {card.site ? card.site.charAt(0).toUpperCase() : head.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{card.title}</p>
          {card.body && <p className="text-[0.8rem] text-muted">{card.body}</p>}
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
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy} onClick={() => input("confirm", { data: { decision: "approve" } })}>
            Approve
          </button>
          <button className="btn-ghost" disabled={busy} onClick={() => input("confirm", { data: { decision: "reject" } })}>
            Reject
          </button>
        </div>
      )}

      {card.kind === "otp" && <OtpForm busy={busy} onCode={(code) => input("otp", { secret: code })} />}

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

      {error && <p className="text-danger">{error}</p>}
      </div>
    </div>
  );
}

const HEAD: Record<string, { icon: string; tone: string }> = {
  question: { icon: "?", tone: "bg-accent-soft text-accent" },
  confirm: { icon: "!", tone: "bg-warn-soft text-warn" },
  otp: { icon: "#", tone: "bg-sunk" },
  connect: { icon: "→", tone: "bg-sunk" },
  secure_input: { icon: "🔒", tone: "bg-sunk" },
};

function Lock({ children }: { children: ReactNode }) {
  return <p className="flex items-center gap-1.5 text-xs text-muted">🔒 {children}</p>;
}

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
            <iframe
              src={card.live_view_url}
              title="Log in"
              className="aspect-video w-full rounded-lg border border-border"
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
          ) : (
            <p className="rounded-lg bg-sunk px-3 py-2 text-xs">
              A browser window opened on the computer running the agent. Log in to {card.site}{" "}
              there, then come back and click Done. Your password stays in that window.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" disabled={busy} onClick={onLoggedIn}>
              Done, I&apos;m logged in
            </button>
            <Lock>Only the login cookies are saved, encrypted</Lock>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-muted">
            I&apos;ll log in for you. If {card.site} texts or emails you a code, I&apos;ll ask for it here.
          </p>
          <SecureForm fields={card.fields ?? []} busy={busy} onSave={onDetails} submitLabel="Save and log in" />
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

function OtpForm({ busy, onCode }: { busy: boolean; onCode: (c: string) => void }) {
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
      <Lock>Goes straight to the vault, never into chat</Lock>
    </form>
  );
}

export function SecureForm({
  fields,
  busy,
  onSave,
  submitLabel = "Save securely",
}: {
  fields: Field[];
  busy: boolean;
  onSave: (secret: Record<string, string>) => void;
  submitLabel?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const complete = fields.every((f) => f.optional || values[f.name]?.trim());
  return (
    <form
      className="space-y-2"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(values);
        setValues({}); // don't keep secrets in component state
      }}
    >
      {fields.map((f) => (
        <label key={f.name} className="block">
          <span className="text-xs text-muted">{f.label ?? f.name}</span>
          <input
            className="input mt-1"
            type={f.type === "password" ? "password" : "text"}
            autoComplete={f.type === "password" ? "new-password" : "off"}
            value={values[f.name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
          />
        </label>
      ))}
      <Lock>Encrypted on arrival. Never shown in chat or to the AI.</Lock>
      <button className="btn-primary" disabled={busy || !complete}>
        {submitLabel}
      </button>
    </form>
  );
}
