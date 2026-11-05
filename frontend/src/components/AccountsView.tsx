"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, api, post, type Field } from "@/lib/api";
import { SecureForm } from "./cards";
import { PageSection } from "./Sidebar";

interface Cred {
  id: string;
  kind: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}
interface Site {
  site: string;
  credentials: Cred[];
  session: { id: string; status: string; source: string; updated_at: string } | null;
}
interface AuditItem {
  action: string;
  site: string | null;
  kind: string | null;
  at: string;
}

const KINDS: { kind: string; label: string; fields: Field[] }[] = [
  {
    kind: "password",
    label: "Password",
    fields: [
      { name: "username", type: "text", label: "Username or email" },
      { name: "password", type: "password", label: "Password" },
    ],
  },
  {
    kind: "totp",
    label: "Authenticator (2FA) setup key",
    fields: [{ name: "secret", type: "password", label: "Setup key (from the site's 2FA page)" }],
  },
  { kind: "api_key", label: "API key", fields: [{ name: "key", type: "password", label: "API key" }] },
  {
    kind: "card",
    label: "Card (no CVV)",
    fields: [
      { name: "number", type: "password", label: "Card number" },
      { name: "expiry", type: "text", label: "Expiry (MM/YY)" },
      { name: "name", type: "text", label: "Name on card" },
    ],
  },
];

const ACTION_LABEL: Record<string, string> = {
  credential_added: "Added",
  credential_updated: "Updated",
  credential_used: "Used by a task",
  credential_revoked: "Removed",
  session_saved: "Login saved",
  session_used: "Login used by a task",
  session_revoked: "Login removed",
  secret_pasted_in_chat: "Blocked a secret pasted in chat",
  phone_verified: "Phone number verified",
  phone_used: "Phone number used by a task",
  phone_removed: "Phone number removed",
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

export function AccountsView() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      Promise.all([
        api<{ sites: Site[] }>("/vault"),
        api<{ items: AuditItem[] }>("/vault/audit?limit=20"),
      ]).then(
        ([vault, log]) => {
          setSites(vault.sites);
          setAudit(log.items);
        },
        () => setError("Couldn't reach the server."),
      ),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
    await load();
  }

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-12 px-4 py-10 sm:px-6">
        {error && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-danger dark:bg-red-950/50">
            {error}{" "}
            <button
              className="underline"
              onClick={() => {
                setError(null);
                void load();
              }}
            >
              Try again
            </button>
          </p>
        )}

        <PageSection title="Logins" note="Sites the assistant can use for you. Values are encrypted and never shown, not even here.">
          {sites === null && <p className="px-2.5 py-4 text-sm text-muted">Loading…</p>}
          {sites?.length === 0 && (
            <p className="px-2.5 py-4 text-sm text-muted">
              Nothing connected yet. Add access below, or the assistant will ask when a task needs it.
            </p>
          )}
          {sites?.map((s) => (
            <div key={s.site} className="border-b border-border px-2.5 py-3.5">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sunk text-sm font-semibold">
                  {s.site.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{s.site.split(".")[0].replace(/^./, (c) => c.toUpperCase())}</p>
                  <span className="tag">{s.site}</span>
                </div>
                {s.session && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      s.session.status === "active" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"
                    }`}
                  >
                    {s.session.status === "active" ? "Logged in" : s.session.status}
                  </span>
                )}
                <button
                  className="btn-ghost px-2.5 py-1 text-xs text-danger"
                  onClick={() => {
                    if (confirm(`Revoke everything for ${s.site}? Running tasks using it will stop.`))
                      void act(() => api(`/vault/sites/${encodeURIComponent(s.site)}`, { method: "DELETE" }));
                  }}
                >
                  Revoke
                </button>
              </div>
              <ul className="mt-2 ml-12 space-y-1 text-sm">
                {s.session && (
                  <li className="text-xs text-muted">Saved login · updated {when(s.session.updated_at)}</li>
                )}
                {s.credentials.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>{KINDS.find((k) => k.kind === c.kind)?.label ?? c.kind}</span>
                    <span className="tag">{c.label}</span>
                    <span className="text-xs text-muted">used {when(c.last_used_at)}</span>
                    <button
                      className="text-xs text-danger hover:underline"
                      onClick={() => void act(() => api(`/vault/credentials/${c.id}`, { method: "DELETE" }))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </PageSection>

        <AddAccess onChange={load} onError={setError} />

        <PageSection title="Activity" note="Every use of a login, key or code.">
          {audit.length === 0 && <p className="px-2.5 py-4 text-sm text-muted">No activity yet.</p>}
          <ul className="text-sm">
            {audit.map((a, i) => (
              <li key={i} className="flex justify-between gap-3 border-b border-border px-2.5 py-2.5">
                <span>
                  {ACTION_LABEL[a.action] ?? a.action}
                  {a.site && <span className="text-muted"> · {a.site}</span>}
                  {a.kind && <span className="text-muted"> · {a.kind}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted">{when(a.at)}</span>
              </li>
            ))}
          </ul>
        </PageSection>
      </div>
    </main>
  );
}

function AddAccess({ onChange, onError }: { onChange: () => void; onError: (e: string | null) => void }) {
  const [site, setSite] = useState("");
  const [kind, setKind] = useState("login");
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState<{ id: string; site: string } | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    onError(null);
    try {
      await fn();
      onChange();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const spec = KINDS.find((k) => k.kind === kind);

  return (
    <PageSection title="Add access" note="Give the assistant a login, key or card ahead of time.">
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <input className="input" placeholder="Site, e.g. github.com" value={site} onChange={(e) => setSite(e.target.value)} />
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="login">Log in myself in a browser</option>
          {KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3">
        {kind === "login" ? (
          login ? (
            <div className="space-y-2 text-sm">
              <p className="rounded-lg bg-sunk px-3 py-2 text-xs">
                A browser window opened on the computer running the agent. Log in to {login.site} there,
                then click Done. Your password stays in that window; only the login cookies are saved.
              </p>
              <div className="flex gap-2">
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await post(`/vault/live-login/${login.id}/complete`, {});
                      setLogin(null);
                    })
                  }
                >
                  Done, I&apos;m logged in
                </button>
                <button
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await post(`/vault/live-login/${login.id}/cancel`, {});
                      setLogin(null);
                    })
                  }
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn-primary"
              disabled={busy || !site.trim()}
              onClick={() =>
                run(async () => {
                  const res = await post<{ id: string; site: string }>("/vault/live-login", { site });
                  setLogin(res);
                })
              }
            >
              Open browser
            </button>
          )
        ) : (
          spec && (
            <SecureForm
              key={kind}
              fields={spec.fields}
              busy={busy || !site.trim()}
              onSave={(secret) => run(() => post("/vault/credentials", { site, kind, secret }))}
            />
          )
        )}
      </div>
    </PageSection>
  );
}
