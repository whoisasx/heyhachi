"use client";

import type { ConfirmationResult } from "firebase/auth";
import { useCallback, useEffect, useState } from "react";

import { PageSection, useUser } from "@/components/Sidebar";
import { ApiError, api, post } from "@/lib/api";
import { confirmCode, firebaseMessage, phoneVerificationConfigured, sendCode } from "@/lib/firebase";

export default function ProfilePage() {
  const { email, name } = useUser();

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-12 px-4 py-10 sm:px-6">
        <PageSection title="Profile" note="How the assistant knows you.">
          <Row icon={(name ?? email).charAt(0).toUpperCase()} title={name ?? "—"} sub="Name from your Google account" />
        </PageSection>

        <PageSection title="Sign-in" note="You sign in with Google. A verified phone number lets the assistant log in to sites for you and only ask for the code.">
          <Row icon="G" title="Google" sub={email} badge={<Badge ok>Connected</Badge>} />
          <PhoneRow />
        </PageSection>
      </div>
    </main>
  );
}

function Row({
  icon,
  title,
  sub,
  badge,
  action,
  flat,
}: {
  icon?: string;
  title: string;
  sub: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  flat?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-2.5 py-3.5 ${flat ? "" : "border-b border-border"}`}>
      {icon && (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sunk text-sm font-semibold">{icon}</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="truncate text-sm text-muted">{sub}</p>
      </div>
      {badge}
      {action}
    </div>
  );
}

function Badge({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${ok ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"}`}>
      {children}
    </span>
  );
}

interface PhoneState {
  phone: { label: string; verified_at: string } | null;
  verification: boolean;
}

const COUNTRIES = [
  { code: "+91", label: "🇮🇳 +91" },
  { code: "+1", label: "🇺🇸 +1" },
  { code: "+44", label: "🇬🇧 +44" },
  { code: "+971", label: "🇦🇪 +971" },
];

/** Phone number: add, verify with an SMS code (Firebase), or remove. */
function PhoneRow() {
  const [state, setState] = useState<PhoneState | null>(null);
  const [step, setStep] = useState<"view" | "number" | "code">("view");
  const [country, setCountry] = useState("+91");
  const [number, setNumber] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  const load = useCallback(() => api<PhoneState>("/me/phone").then(setState, () => setError("Couldn't load your number.")), []);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const e164 = `${country}${number.replace(/\D/g, "")}`;
  const enabled = phoneVerificationConfigured && state?.verification;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      setConfirmation(await sendCode(e164, "recaptcha-box"));
      setStep("code");
      setCode("");
      setResendIn(30);
    } catch (err) {
      setError(firebaseMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!confirmation) return;
    setBusy(true);
    setError(null);
    try {
      const idToken = await confirmCode(confirmation, code);
      const saved = await post<{ phone: PhoneState["phone"] }>("/me/phone", { id_token: idToken });
      setState((s) => ({ verification: s?.verification ?? true, phone: saved.phone }));
      setStep("view");
      setNumber("");
      setConfirmation(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : firebaseMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Remove your phone number? The assistant will ask for it again when a site needs it.")) return;
    setBusy(true);
    try {
      await api("/me/phone", { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const phone = state?.phone;
  return (
    <div className="border-b border-border">
      <Row
        icon="📱"
        title="Phone"
        sub={phone ? phone.label : state && !enabled ? "Verification isn't set up on this server yet" : "Not added"}
        badge={phone ? <Badge ok>Verified</Badge> : enabled ? <Badge>Not verified</Badge> : undefined}
        action={
          step === "view" &&
          enabled && (
            <span className="flex gap-2">
              <button className="btn-ghost px-2.5 py-1 text-xs" disabled={busy} onClick={() => setStep("number")}>
                {phone ? "Change" : "Add & verify"}
              </button>
              {phone && (
                <button className="btn-ghost px-2.5 py-1 text-xs text-danger" disabled={busy} onClick={remove}>
                  Remove
                </button>
              )}
            </span>
          )
        }
        flat
      />

      {step !== "view" && (
        <div className="mx-2.5 mb-4 space-y-3 rounded-2xl border border-border bg-surface p-4">
          {step === "number" ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label className="text-xs text-muted" htmlFor="phone-number">
                Mobile number
              </label>
              <div className="flex gap-2">
                <select className="input w-28" value={country} onChange={(e) => setCountry(e.target.value)}>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <input
                  id="phone-number"
                  className="input"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <button className="btn-primary" disabled={busy || number.replace(/\D/g, "").length < 6}>
                  {busy ? "Sending…" : "Send code"}
                </button>
                <button type="button" className="btn-ghost" onClick={() => setStep("view")}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void verify();
              }}
            >
              <label className="text-xs text-muted" htmlFor="phone-code">
                Enter the 6-digit code sent to {country} {number}
              </label>
              <input
                id="phone-code"
                className="input max-w-44 py-2.5 text-center font-mono text-lg tracking-[0.4em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                autoFocus
              />
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" disabled={busy || code.length !== 6}>
                  {busy ? "Checking…" : "Verify"}
                </button>
                <button type="button" className="btn-ghost" disabled={busy || resendIn > 0} onClick={() => void send()}>
                  {resendIn > 0 ? `Resend in 0:${String(resendIn).padStart(2, "0")}` : "Resend code"}
                </button>
                <button type="button" className="btn-ghost" onClick={() => setStep("number")}>
                  Change number
                </button>
              </div>
            </form>
          )}
          <p className="text-xs text-muted">
            🔒 The code is checked by Google (Firebase). We keep only the number, encrypted, and use it when a site asks
            you to log in with your phone.
          </p>
          <p className="text-xs text-muted">
            Protected by reCAPTCHA. Google&apos;s{" "}
            <a className="underline" href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
              Privacy Policy
            </a>{" "}
            and{" "}
            <a className="underline" href="https://policies.google.com/terms" target="_blank" rel="noreferrer">
              Terms
            </a>{" "}
            apply.
          </p>
        </div>
      )}
      {error && <p className="px-2.5 pb-3 text-sm text-danger">{error}</p>}
      <div id="recaptcha-box" />
    </div>
  );
}
