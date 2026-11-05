"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, api, post, type Field } from "@/lib/api";
import { SecureForm } from "./SecureForm";
import { useConfirm } from "./Confirm";
import { LiveView } from "./LiveView";
import { Select } from "./Select";
import { PageHeader, PageSection } from "./Sidebar";

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
    label: "Credentials",
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
      { name: "number", type: "text", label: "Card number" },
      { name: "expiry", type: "text", label: "Expiry" },
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
      <div className="mx-auto flex max-w-3xl flex-col gap-9 px-4 py-10 sm:px-6">
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
        <PageHeader
          title="Vault"
          note="Logins, keys and cards Hachi can use for you. Everything is encrypted, never shown to the AI, and never shown again, not even here."
        />
        <PageSection title="Saved logins and keys">
          {sites === null && (
            <div className="space-y-3 px-4 py-4" aria-label="Loading">
              {[60, 45].map((w) => (
                <div key={w} className="flex items-center gap-3">
                  <span className="h-9 w-9 animate-pulse rounded-xl bg-sunk" />
                  <span className="h-4 animate-pulse rounded bg-sunk" style={{ width: `${w}%` }} />
                </div>
              ))}
            </div>
          )}
          {sites?.length === 0 && (
            <Empty
              icon="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z"
              text="Nothing saved yet. Add a login below, or Hachi will ask when a task needs one."
            />
          )}
          {sites?.map((s) => (
            <SiteBlock
              key={s.site}
              site={s}
              onRemoveAll={async () => {
                const ok = await confirm({
                  title: `Remove everything for ${s.site}?`,
                  body: "Its saved login and keys are deleted. Any task using them stops.",
                  confirmLabel: "Remove all",
                });
                if (ok) void act(() => api(`/vault/sites/${encodeURIComponent(s.site)}`, { method: "DELETE" }));
              }}
              onRemove={async (c) => {
                const ok = await confirm({
                  title: c ? `Remove this ${kindLabel(c.kind).toLowerCase()}?` : `Remove the saved login for ${s.site}?`,
                  body: `It's deleted for good. Hachi will ask again if a task needs it.`,
                  confirmLabel: "Remove",
                });
                if (!ok) return;
                // the signed-in session has no delete of its own: removing the site's only item removes the site
                void act(() =>
                  c
                    ? api(`/vault/credentials/${c.id}`, { method: "DELETE" })
                    : api(`/vault/sites/${encodeURIComponent(s.site)}`, { method: "DELETE" }),
                );
              }}
            />
          ))}
        </PageSection>

        <AddAccess onChange={load} onError={setError} />

        <PageSection title="Activity" note="Every time a login, key or code was added, used or removed.">
          {sites === null && <div className="m-4 h-4 w-1/2 animate-pulse rounded bg-sunk" aria-label="Loading" />}
          {sites !== null && audit.length === 0 && (
            <Empty icon="M12 8v4l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" text="No activity yet. Uses of your logins and keys show up here." />
          )}
          <ul className="text-sm">
            {audit.map((a, i) => (
              <li key={i} className="flex justify-between gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
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

/**
 * A site's logo from Google's favicon service (it sees only the site name, never what's saved),
 * or its first letter when the site has no real icon (Google then sends a 16px globe).
 */
export function SiteLogo({ site, size = 36 }: { site: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-surface text-sm font-semibold"
      style={{ width: size, height: size }}
    >
      {failed ? (
        site.charAt(0).toUpperCase()
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- tiny remote favicon
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(site)}&sz=64`}
          alt=""
          width={size * 0.55}
          height={size * 0.55}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          onLoad={(e) => e.currentTarget.naturalWidth <= 16 && setFailed(true)}
        />
      )}
    </span>
  );
}

const KIND_ICON: Record<string, string> = {
  password: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z",
  totp: "M12 8v4l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  api_key: "M15 7a4 4 0 1 1-3.9 4.9L4 19v2h3v-2h2v-2h2l1.1-1.1A4 4 0 0 1 15 7z",
  card: "M3 6h18v12H3zM3 10h18",
  session: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3",
};

/** One site in the Vault: its logo and name, then one tidy row per saved thing. */
function SiteBlock({
  site: s,
  onRemove,
  onRemoveAll,
}: {
  site: Site;
  onRemove: (c: Cred | null) => void;
  onRemoveAll: () => void;
}) {
  const count = s.credentials.length + (s.session ? 1 : 0);
  const name = s.site.split(".")[0].replace(/^./, (c) => c.toUpperCase());
  const rows = [
    ...(s.session
      ? [{ key: s.session.id, icon: KIND_ICON.session, title: "Signed-in session", value: SESSION_LABEL[s.session.status] ?? s.session.status, meta: `Saved ${when(s.session.updated_at)}`, cred: null as Cred | null, ok: s.session.status === "active" }]
      : []),
    ...s.credentials.map((c) => ({
      key: c.id,
      icon: KIND_ICON[c.kind] ?? KIND_ICON.password,
      title: kindLabel(c.kind),
      // labels read "t…@example.com · swiggy.com": the site is already in the heading
      value: c.label.replace(new RegExp(`\\s*·\\s*${s.site.replace(/\./g, "\\.")}$`), ""),
      meta: c.last_used_at ? `Last used ${when(c.last_used_at)}` : "Not used yet",
      cred: c as Cred | null,
      ok: undefined as boolean | undefined,
    })),
  ];
  return (
    <div className="border-b border-border px-4 py-4">
      <div className="flex items-center gap-3">
        <SiteLogo site={s.site} />
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-tight">{name}</p>
          <p className="text-xs text-muted">{s.site}</p>
        </div>
        {count > 1 && (
          <button className="btn-ghost px-2.5 py-1 text-xs text-danger" onClick={onRemoveAll} title={`Remove all ${count} saved items for ${s.site}`}>
            Remove all ({count})
          </button>
        )}
      </div>
      <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3 bg-background/40 px-3 py-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sunk text-muted">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={r.icon} />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm">{r.title}</p>
              <p className="truncate text-xs text-muted">
                {r.ok === undefined ? <span className="font-mono">{r.value}</span> : <span className={r.ok ? "text-ok" : "text-warn"}>{r.value}</span>}
                <span> · {r.meta}</span>
              </p>
            </div>
            {/* with several items, the session goes with "Remove all"; anything alone gets its own Remove */}
            {(r.cred || count === 1) && (
              <button
                className="shrink-0 rounded-md px-2 py-1 text-xs text-muted hover:bg-sunk hover:text-danger"
                onClick={() => onRemove(r.cred)}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-5 text-sm text-muted">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={icon} />
        </svg>
      </span>
      {text}
    </div>
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
      <div className="space-y-3 p-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="input" aria-label="Website" placeholder="Any website, like swiggy.com" value={site} onChange={(e) => setSite(e.target.value)} />
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

      <div>
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
              Open a browser to sign in
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
      </div>
    </PageSection>
  );
}
