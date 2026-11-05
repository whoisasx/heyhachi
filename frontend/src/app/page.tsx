import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { auth, devLoginEnabled, signIn } from "@/auth";

export default function Home() {
  return (
    <Suspense>
      <SignInGate />
    </Suspense>
  );
}

// Signed-in users go straight to the chat.
async function SignInGate() {
  await connection();
  const session = await auth();
  if (session?.user) redirect("/chat");

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="serif text-5xl">Browser Agent</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Ask for something to be done on a website. It works in a real browser, and keeps your
          logins, codes and keys out of the chat.
        </p>

        <form
          className="mt-8 border-t border-foreground pt-6"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/chat" });
          }}
        >
          <button type="submit" className="btn-primary w-full">
            Sign in with Google
          </button>
        </form>

        {devLoginEnabled && (
          <form
            className="mt-6 border-t border-border pt-6"
            action={async (form: FormData) => {
              "use server";
              await signIn("dev", { email: form.get("email"), redirectTo: "/chat" });
            }}
          >
            <p className="mb-2 text-xs text-muted">Local development only</p>
            <div className="flex gap-2">
              <input
                name="email"
                type="email"
                required
                placeholder="you@example.com"
                className="input"
              />
              <button type="submit" className="btn-ghost shrink-0">
                Dev login
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
