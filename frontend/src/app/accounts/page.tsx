import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { auth } from "@/auth";
import { AccountsView } from "@/components/AccountsView";
import { AppHeader } from "@/components/AppHeader";

export default function AccountsPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted">Loading…</p>}>
      <SignedInAccounts />
    </Suspense>
  );
}

async function SignedInAccounts() {
  await connection();
  const session = await auth();
  if (!session?.user?.email) redirect("/");
  return (
    <>
      <AppHeader email={session.user.email} active="accounts" />
      <AccountsView />
    </>
  );
}
