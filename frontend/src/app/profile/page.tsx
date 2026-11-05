import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { auth } from "@/auth";
import { PageSection, Shell } from "@/components/Sidebar";

export default function ProfilePage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted">Loading…</p>}>
      <SignedInProfile />
    </Suspense>
  );
}

async function SignedInProfile() {
  await connection();
  const session = await auth();
  if (!session?.user?.email) redirect("/");
  const { email, name } = session.user;

  return (
    <Shell email={email} active="profile">
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

          <PageSection title="Safety" note="Limits on every task.">
            <Row title="Spending limit per task" sub="AI and browser cost together" badge={<span className="tag">$1.00</span>} />
            <Row title="Ask before irreversible actions" sub="Paying, ordering, sending, deleting" badge={<Badge ok>Always on</Badge>} />
            <Row title="Waiting for you" sub="A task pauses if a card isn't answered" badge={<span className="tag">10 min</span>} />
          </PageSection>
        </div>
      </main>
    </Shell>
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
