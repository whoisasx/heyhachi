import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { auth } from "@/auth";
import { AppHeader } from "@/components/AppHeader";
import { ChatApp } from "@/components/ChatApp";

export default function ChatPage({ searchParams }: PageProps<"/chat">) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted">Loading…</p>}>
      <SignedInChat searchParams={searchParams} />
    </Suspense>
  );
}

// Reads the session, so it runs per request behind the Suspense boundary.
async function SignedInChat({ searchParams }: Pick<PageProps<"/chat">, "searchParams">) {
  await connection();
  const session = await auth();
  if (!session?.user?.email) redirect("/");
  const { c } = await searchParams;
  return (
    <>
      <AppHeader email={session.user.email} active="chat" />
      <ChatApp initialId={typeof c === "string" ? c : null} />
    </>
  );
}
