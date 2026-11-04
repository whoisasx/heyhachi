import { useState } from "react";

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

  if (state === "sent") return <p className="text-muted">Sent. Continuing…</p>;
  const busy = state === "sending";

  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">{card.title}</p>
        {card.body && <p className="mt-1 text-muted">{card.body}</p>}
      </div>

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
        <div className="space-y-2">
          {card.live_view_url ? (
            <iframe
              src={card.live_view_url}
              title="Log in"
              className="aspect-video w-full rounded-lg border border-border"
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
          ) : (
            <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs">
              A browser window opened on the computer running the agent. Log in to {card.site}{" "}
              there, then come back and click Done. Your password stays in that window.
            </p>
          )}
          <button className="btn-primary" disabled={busy} onClick={() => input("credential_ready", { data: {} })}>
            Done, I&apos;m logged in
          </button>
        </div>
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
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onCode(code);
      }}
    >
      <input
        className="input max-w-40 font-mono tracking-widest"
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
  const complete = fields.every((f) => values[f.name]?.trim());
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
      <p className="text-xs text-muted">Encrypted on arrival. Never shown in chat or to the AI.</p>
      <button className="btn-primary" disabled={busy || !complete}>
        {submitLabel}
      </button>
    </form>
  );
}
