"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, api, post, type Field } from "@/lib/api";
import { SecureForm } from "./cards";
import { useConfirm } from "./Confirm";
import { LiveView } from "./LiveView";
import { Select } from "./Select";
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
    label: "Username & password",
    fields: [
      { name: "username", type: "text", label: "Username or email" },
      { name: "password", type: "password", label: "Password" },
    ],
  },
  {
    kind: "totp",
    label: "2FA authenticator key",
    fields: [{ name: "secret", type: "password", label: "Setup key (from the site's 2FA page)" }],
  },
  { kind: "api_key", label: "API key", fields: [{ name: "key", type: "password", label: "API key" }] },
  {
    kind: "card",
    label: "Payment card (no CVV)",
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

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const kindLabel = (kind: string) =>
  KINDS.find((k) => k.kind === kind)?.label ?? (kind === "phone" ? "Phone number" : kind.replace(/_/g, " "));

const SESSION_LABEL: Record<string, string> = { active: "Signed in", expired: "Signed out", revoked: "Removed" };

export function AccountsView() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialog, confirm] = useConfirm();

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

        {dialog}
        <PageSection
          title="Saved access"
          note="Logins, keys and cards the assistant can use for you. Everything is encrypted, and saved values are never shown again, not even here."
        >
          {sites === null && <p className="px-2.5 py-4 text-sm text-muted">Loading…</p>}
          {sites?.length === 0 && (
            <p className="px-2.5 py-4 text-sm text-muted">
              Nothing saved yet. Add something below, or the assistant will ask when a task needs it.
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
                    {SESSION_LABEL[s.session.status] ?? s.session.status}
                  </span>
                )}
                <button
                  className="btn-ghost px-2.5 py-1 text-xs text-danger"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Remove everything for ${s.site}?`,
                      body: "Saved logins, keys and cards for this site are deleted. Any task using them stops.",
                      confirmLabel: "Remove all",
                    });
                    if (ok) void act(() => api(`/vault/sites/${encodeURIComponent(s.site)}`, { method: "DELETE" }));
                  }}
                >
                  Remove all
                </button>
              </div>
              <ul className="mt-2 ml-12 space-y-1 text-sm">
                {s.session && (
                  <li className="text-xs text-muted">Signed-in session saved · {when(s.session.updated_at)}</li>
                )}
                {s.credentials.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>{kindLabel(c.kind)}</span>
                    <span className="tag">{c.label}</span>
                    <span className="text-xs text-muted">
                      {c.last_used_at ? `Last used ${when(c.last_used_at)}` : "Not used yet"}
                    </span>
                    <button
                      className="text-xs text-danger hover:underline"
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Remove this ${kindLabel(c.kind).toLowerCase()}?`,
                          body: `It's deleted from ${s.site} for good. The assistant will ask again if a task needs it.`,
                        });
                        if (ok) void act(() => api(`/vault/credentials/${c.id}`, { method: "DELETE" }));
                      }}
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

        <PageSection title="Activity" note="Every time a login, key or code was added, used or removed.">
          {audit.length === 0 && <p className="px-2.5 py-4 text-sm text-muted">No activity yet.</p>}
          <ul className="text-sm">
            {audit.map((a, i) => (
              <li key={i} className="flex justify-between gap-3 border-b border-border px-2.5 py-2.5">
                <span>
                  {ACTION_LABEL[a.action] ?? a.action}
                  {a.site && a.site !== "profile" && <span className="text-muted"> · {a.site}</span>}
                  {a.kind && !a.action.startsWith("phone_") && <span className="text-muted"> · {kindLabel(a.kind)}</span>}
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
  const [login, setLogin] = useState<{ id: string; site: string; live_view_url?: string | null } | null>(null);

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

  const doneButtons = login && (
    <>
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
        Done, I&apos;m signed in
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
    </>
  );

  return (
    <PageSection title="Add access" note="Save a login, key or card now, so tasks don't have to stop and ask.">
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <input className="input" placeholder="Site, e.g. github.com" value={site} onChange={(e) => setSite(e.target.value)} />
        <Select
          label="What kind of access"
          value={kind}
          onChange={setKind}
          options={[
            { value: "login", label: "Sign in on the website", hint: "You sign in yourself; we keep the session, not your password" },
            ...KINDS.map((k) => ({ value: k.kind, label: k.label })),
          ]}
        />
      </div>

      <div className="mt-3">
        {kind === "login" ? (
          login ? (
            <div className="space-y-2 text-sm">
              {login.live_view_url ? (
                <LiveView url={login.live_view_url} title={`Sign in to ${login.site}`} actions={doneButtons} />
              ) : (
                <p className="rounded-lg bg-sunk px-3 py-2 text-xs">
                  A Chrome window opened on the computer running Hachi. Sign in to {login.site} there, then click
                  Done.
                </p>
              )}
              <p className="text-xs text-muted">Your password stays in that browser; we only save the signed-in session.</p>
              <div className="flex gap-2">{doneButtons}</div>
            </div>
          ) : (
            <button
              className="btn-primary"
              disabled={busy || !site.trim()}
              onClick={() =>
                run(async () => {
                  const res = await post<{ id: string; site: string; live_view_url?: string | null }>("/vault/live-login", { site });
                  setLogin(res);
                })
              }
            >
              Open sign-in window
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
