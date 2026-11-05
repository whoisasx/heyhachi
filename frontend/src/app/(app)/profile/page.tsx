"use client";

import { PageSection, useUser } from "@/components/Sidebar";

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
          <Row
            icon="📱"
            title="Phone"
            sub="Not added"
            badge={<Badge>Coming soon</Badge>}
            action={
              <button className="btn-ghost px-2.5 py-1 text-xs" disabled>
                Add &amp; verify
              </button>
            }
          />
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
}: {
  icon?: string;
  title: string;
  sub: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-2.5 py-3.5">
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
