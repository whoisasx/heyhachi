"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, api, post, type Field } from "@/lib/api";
import { SecureForm } from "./cards";

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
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        <section>
          <h1 className="text-xl font-semibold">Connected accounts</h1>
          <p className="mt-1 text-sm text-muted">
            What the assistant can use on your behalf. Values are encrypted and never shown,
            not even here.
          </p>
          {error && (
            <p className="mt-3 text-sm text-danger">
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
        </section>

        <section className="space-y-3">
          {sites === null && <p className="text-sm text-muted">Loading…</p>}
          {sites?.length === 0 && (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
              Nothing connected yet. Add access below, or the assistant will ask when a task needs it.
            </p>
          )}
          {sites?.map((s) => (
            <div key={s.site} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">{s.site}</h2>
                <button
                  className="btn-danger py-1.5"
                  onClick={() => {
                    if (confirm(`Revoke everything for ${s.site}? Running tasks using it will stop.`))
                      void act(() => api(`/vault/sites/${encodeURIComponent(s.site)}`, { method: "DELETE" }));
                  }}
                >
                  Revoke all
                </button>
              </div>
              <ul className="mt-3 divide-y divide-border text-sm">
                {s.session && (
                  <li className="flex items-center justify-between py-2">
                    <span>
                      Saved login{" "}
                      <span className={s.session.status === "active" ? "text-ok" : "text-amber-600"}>
                        ({s.session.status})
                      </span>
                    </span>
                    <span className="text-xs text-muted">updated {when(s.session.updated_at)}</span>
                  </li>
                )}
                {s.credentials.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      {KINDS.find((k) => k.kind === c.kind)?.label ?? c.kind}:{" "}
                      <span className="font-mono text-xs">{c.label}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-muted">used {when(c.last_used_at)}</span>
                      <button
                        className="text-xs text-danger hover:underline"
                        onClick={() => void act(() => api(`/vault/credentials/${c.id}`, { method: "DELETE" }))}
                      >
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <AddAccess onChange={load} onError={setError} />

        <section>
          <h2 className="font-medium">Recent activity</h2>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface text-sm">
            {audit.length === 0 && <li className="p-3 text-muted">No activity yet.</li>}
            {audit.map((a, i) => (
              <li key={i} className="flex justify-between gap-3 px-3 py-2">
                <span>
                  {ACTION_LABEL[a.action] ?? a.action}
                  {a.site && <span className="text-muted"> · {a.site}</span>}
                  {a.kind && <span className="text-muted"> · {a.kind}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted">{when(a.at)}</span>
              </li>
            ))}
          </ul>
        </section>
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
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="font-medium">Add access</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
              <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs">
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
    </section>
  );
}
