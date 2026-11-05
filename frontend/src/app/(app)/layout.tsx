import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { auth } from "@/auth";
import { Shell, ShellSkeleton } from "@/components/Sidebar";

/**
 * Shared by Chats, Vault and Profile. Layouts stay mounted when you move between
 * these pages, so the sign-in check and the sidebar run once, not on every click.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <SignedIn>{children}</SignedIn>
    </Suspense>
  );
}

async function SignedIn({ children }: { children: React.ReactNode }) {
  await connection();
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");
  return (
    <Shell email={email} name={session.user?.name ?? null}>
      {children}
    </Shell>
  );
}
