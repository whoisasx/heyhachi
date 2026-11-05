"use client";

import { useState, type ReactNode } from "react";

import type { Field } from "@/lib/api";

/*
 * The form for anything secret (Vault "Add access", and the cards a task shows).
 * Values go straight to the backend and are dropped from state right after.
 *
 * - every hidden field has an eye button to show or hide what you typed
 * - a password and a card number are typed twice, so a typo can't be saved
 * - a card form checks as you type: the number fills in "•••• ••••" and is checked
 *   (length + Luhn), expiry is MM/YY and not in the past, the name is letters only
 */

type Role = "plain" | "secret" | "cardNumber" | "expiry" | "cardName";

function roleOf(f: Field, fields: Field[]): Role {
  const card = fields.some((x) => x.name === "number") && fields.some((x) => x.name === "expiry");
  if (card && f.name === "number") return "cardNumber";
  if (card && f.name === "expiry") return "expiry";
  if (card && f.name === "name") return "cardName";
  return f.type === "password" ? "secret" : "plain";
}

/** Fields typed twice: a password, a card number. */
const needsConfirm = (f: Field, role: Role) => role === "cardNumber" || (role === "secret" && f.name === "password");

// --- card helpers ---------------------------------------------------------------

const digitsOf = (s: string) => s.replace(/\D/g, "");

export function cardBrand(digits: string): { name: string; max: number; groups: number[] } {
  if (/^3[47]/.test(digits)) return { name: "Amex", max: 15, groups: [4, 6, 5] };
  if (/^4/.test(digits)) return { name: "Visa", max: 16, groups: [4, 4, 4, 4] };
  if (/^(5[1-5]|2[2-7])/.test(digits)) return { name: "Mastercard", max: 16, groups: [4, 4, 4, 4] };
  if (/^(60|65|81|82|508)/.test(digits)) return { name: "RuPay", max: 16, groups: [4, 4, 4, 4] };
  if (/^3(0[0-5]|[689])/.test(digits)) return { name: "Diners", max: 14, groups: [4, 6, 4] };
  return { name: "", max: 19, groups: [4, 4, 4, 4, 3] };
}

/** "4111111111111111" → "4111 1111 1111 1111" (Amex 4-6-5). */
export function formatCard(digits: string) {
  const { groups } = cardBrand(digits);
  const out: string[] = [];
  let i = 0;
  for (const g of groups) {
    if (i >= digits.length) break;
    out.push(digits.slice(i, i + g));
    i += g;
  }
  return out.join(" ");
}

/** The same layout, all dots: what's left to type. */
const cardGhost = (digits: string) => formatCard("•".repeat(cardBrand(digits).max));

export function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length > 0 && sum % 10 === 0;
}

function cardNumberProblem(v: string): string | null {
  const d = digitsOf(v);
  const { max, name } = cardBrand(d);
  if (d.length < (name ? max : 12)) return null; // still typing
  return luhn(d) ? null : "This card number doesn't look right. Check the digits.";
}

/** Types "0" "8" "2" "7" as "08/27"; a first digit above 1 becomes "0X/". */
export function formatExpiry(raw: string, prev: string) {
  let d = digitsOf(raw).slice(0, 4);
  if (d.length >= 1 && Number(d[0]) > 1) d = `0${d}`.slice(0, 4); // "8" means August: "08"
  // a month is 01-12: drop a second digit that can't be one
  if (d.length >= 2 && (Number(d.slice(0, 2)) > 12 || d.slice(0, 2) === "00")) d = d.slice(0, 1);
  // deleting the slash deletes the digit before it
  if (raw.length < prev.length && prev.endsWith("/") && !raw.endsWith("/")) d = d.slice(0, 1);
  return d.length >= 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

function expiryProblem(v: string): string | null {
  if (!/^\d{2}\/\d{2}$/.test(v)) return null; // still typing
  const month = Number(v.slice(0, 2));
  const year = 2000 + Number(v.slice(3));
  if (month < 1 || month > 12) return "The month should be 01 to 12.";
  const now = new Date();
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1))
    return "This card has expired.";
  if (year > now.getFullYear() + 20) return "Check the year.";
  return null;
}

const cleanName = (v: string) => v.replace(/[^\p{L} .'-]/gu, "").replace(/\s{2,}/g, " ");

function isValid(role: Role, v: string) {
  if (role === "cardNumber") {
    const d = digitsOf(v);
    const { max, name } = cardBrand(d);
    return (name ? d.length === max : d.length >= 12) && luhn(d);
  }
  if (role === "expiry") return /^\d{2}\/\d{2}$/.test(v) && !expiryProblem(v);
  if (role === "cardName") return v.trim().length >= 2;
  return true;
}

// --- the form ---------------------------------------------------------------------

export function SecureForm({
  fields,
  busy,
  onSave,
  submitLabel = "Save securely",
  note = "Encrypted on arrival. Never shown in chat or to the AI.",
}: {
  fields: Field[];
  busy: boolean;
  onSave: (secret: Record<string, string>) => void;
  submitLabel?: string;
  note?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<Record<string, string>>({});
  const set = (name: string, v: string) => setValues((x) => ({ ...x, [name]: v }));

  const rows = fields.map((f) => ({ f, role: roleOf(f, fields) }));
  const matches = (name: string, role: Role) => {
    const a = values[name] ?? "";
    const b = confirm[name] ?? "";
    return role === "cardNumber" ? digitsOf(a) === digitsOf(b) : a === b;
  };
  const complete = rows.every(({ f, role }) => {
    const v = values[f.name] ?? "";
    if (!v.trim()) return !!f.optional;
    return isValid(role, v) && (!needsConfirm(f, role) || matches(f.name, role));
  });

  return (
    <form
      className="space-y-3"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        if (!complete) return;
        const out: Record<string, string> = {};
        for (const { f, role } of rows) {
          const v = values[f.name] ?? "";
          if (!v && f.optional) continue;
          out[f.name] = role === "cardNumber" ? digitsOf(v) : role === "cardName" ? v.trim() : v;
        }
        onSave(out);
        setValues({}); // don't keep secrets in component state
        setConfirm({});
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
      {rows.map(({ f, role }) => {
        const v = values[f.name] ?? "";
        const c = confirm[f.name] ?? "";
        const problem = role === "cardNumber" ? cardNumberProblem(v) : role === "expiry" ? expiryProblem(v) : null;
        const confirmLabel = role === "cardNumber" ? "Confirm card number" : `Confirm ${(f.label ?? f.name).toLowerCase()}`;
        const showConfirm = needsConfirm(f, role) && (v || !f.optional);
        const mismatch = showConfirm && c && (role === "cardNumber" ? digitsOf(c).length >= digitsOf(v).length : c.length >= v.length) && !matches(f.name, role);
        return (
          <div key={f.name} className={role === "expiry" || role === "cardName" ? "" : "sm:col-span-2"}>
            <Labelled label={f.label ?? f.name} hint={problem} ok={role === "cardNumber" && isValid(role, v) ? cardBrand(digitsOf(v)).name || "Valid" : null}>
              <FieldInput role={role} value={v} onChange={(x) => set(f.name, x)} ariaLabel={f.label ?? f.name} />
            </Labelled>
            {showConfirm && (
              <div className="mt-2">
                <Labelled label={confirmLabel} hint={mismatch ? "Doesn't match. Type it again." : null} ok={c && matches(f.name, role) ? "Matches" : null}>
                  <FieldInput role={role} value={c} onChange={(x) => setConfirm((m) => ({ ...m, [f.name]: x }))} ariaLabel={confirmLabel} confirm />
                </Labelled>
              </div>
            )}
          </div>
        );
      })}
      </div>
      <Lock>{note}</Lock>
      <button className="btn-primary" disabled={busy || !complete}>
        {submitLabel}
      </button>
    </form>
  );
}

function Labelled({ label, hint, ok, children }: { label: string; hint?: string | null; ok?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-2 text-xs text-muted">
        {label}
        {ok && !hint && <span className="text-ok">✓ {ok}</span>}
      </span>
      <span className="mt-1 block">{children}</span>
      {hint && (
        <span role="alert" className="mt-1 block text-xs text-danger">
          {hint}
        </span>
      )}
    </label>
  );
}

function FieldInput({
  role,
  value,
  onChange,
  ariaLabel,
  confirm,
}: {
  role: Role;
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  confirm?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const hidden = role === "secret" || (role === "cardNumber" && confirm);

  if (role === "cardNumber" && !confirm) {
    // the dots fill in as you type
    const d = digitsOf(value);
    const shownText = formatCard(d);
    return (
      <span className="relative block rounded-lg bg-background">
        <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center px-3 font-mono text-sm tracking-wider">
          <span className="invisible whitespace-pre">{shownText}</span>
          <span className="whitespace-pre text-muted/60">{cardGhost(d).slice(shownText.length)}</span>
        </span>
        <input
          className="input relative bg-transparent font-mono tracking-wider"
          inputMode="numeric"
          autoComplete="off"
          aria-label={ariaLabel}
          value={shownText}
          onChange={(e) => onChange(digitsOf(e.target.value).slice(0, cardBrand(digitsOf(e.target.value)).max))}
        />
      </span>
    );
  }
  if (role === "expiry") {
    return (
      <span className="relative block rounded-lg bg-background">
        <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center px-3 font-mono text-sm tracking-wider">
          <span className="invisible whitespace-pre">{value}</span>
          <span className="whitespace-pre text-muted/60">{"MM/YY".slice(value.length)}</span>
        </span>
        <input
          className="input relative bg-transparent font-mono tracking-wider"
          inputMode="numeric"
          autoComplete="off"
          aria-label={ariaLabel}
          value={value}
          onChange={(e) => onChange(formatExpiry(e.target.value, value))}
        />
      </span>
    );
  }
  if (role === "cardName")
    return (
      <input
        className="input"
        autoComplete="off"
        aria-label={ariaLabel}
        placeholder="As printed on the card"
        value={value}
        onChange={(e) => onChange(cleanName(e.target.value))}
      />
    );

  return (
    <span className="relative block">
      <input
        className={`input ${hidden ? "pr-11" : ""} ${role === "cardNumber" ? "font-mono tracking-wider" : ""}`}
        type={hidden && !shown ? "password" : "text"}
        inputMode={role === "cardNumber" ? "numeric" : undefined}
        autoComplete={hidden ? "new-password" : "off"}
        aria-label={ariaLabel}
        value={role === "cardNumber" ? formatCard(digitsOf(value)) : value}
        onChange={(e) =>
          onChange(role === "cardNumber" ? digitsOf(e.target.value).slice(0, 19) : e.target.value)
        }
        // no pasting into a confirm box: it's there to catch typos
        onPaste={confirm ? (e) => e.preventDefault() : undefined}
      />
      {hidden && (
        <button
          type="button"
          aria-label={shown ? "Hide" : "Show"}
          aria-pressed={shown}
          title={shown ? "Hide" : "Show"}
          onClick={() => setShown((s) => !s)}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted hover:text-foreground"
        >
          <Eye off={shown} />
        </button>
      )}
    </span>
  );
}

function Eye({ off }: { off: boolean }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

export function Lock({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted">
      <svg className="mt-px shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
        <path d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z" />
      </svg>
      <span>{children}</span>
    </p>
  );
}
