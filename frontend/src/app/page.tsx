import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { auth, devLoginEnabled, signIn } from "@/auth";
import { AgentDemo } from "@/components/AgentDemo";
import { GoogleButton } from "@/components/GoogleButton";
import { Paw } from "@/components/Logo";

export default function Home() {
  return (
    <main className="grid min-h-full flex-1 lg:grid-cols-[1.15fr_1fr]">
      <section className="hidden lg:block">
        <AgentDemo />
      </section>
      <Suspense>
        <SignInGate />
      </Suspense>
    </main>
  );
}

const PROMISES = ["Free to try", "Asks before paying", "Logins stay private"];

// Signed-in users go straight to the chat.
async function SignInGate() {
  await connection();
  const session = await auth();
  if (session?.user) redirect("/chat");

  return (
    <section className="flex flex-col px-6 py-10 sm:px-12 lg:px-16">
      <div className="my-auto w-full max-w-md">
        <div className="flex items-center gap-3">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-foreground text-background shadow-[0_12px_40px_rgba(47,91,234,0.25)]">
            <Paw size={28} />
          </span>
          <span>
            <span className="display block text-xl leading-tight">Hachi</span>
            <span className="block text-sm text-muted">The loyal agent</span>
          </span>
        </div>

        <h1 className="display mt-8 text-[2.6rem] leading-[1.05] sm:text-5xl">
          Get it done
          <br />
          <span className="text-accent">on any website.</span>
        </h1>
        <p className="mt-5 max-w-sm leading-relaxed text-muted">
          Tell Hachi what you need. It works in a real browser, sticks with the job until it&apos;s
          done, and keeps your logins, codes and keys out of the chat.
        </p>

        <form
          className="mt-9"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/chat" });
          }}
        >
          <GoogleButton />
        </form>

        <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
          {PROMISES.map((p) => (
            <li key={p} className="flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-ok" aria-hidden>
                <path d="M5 12l5 5L20 7" />
              </svg>
              {p}
            </li>
          ))}
        </ul>

        {devLoginEnabled && (
          <form
            className="mt-10 border-t border-border pt-6"
            action={async (form: FormData) => {
              "use server";
              await signIn("dev", { email: form.get("email"), redirectTo: "/chat" });
            }}
          >
            <p className="mb-2 text-xs text-muted">Local development only</p>
            <div className="flex gap-2">
              <input name="email" type="email" required placeholder="you@example.com" className="input" />
              <button type="submit" className="btn-ghost shrink-0">
                Dev login
              </button>
            </div>
          </form>
        )}
      </div>

      <p className="mt-10 text-xs text-muted">
        Signing in only shares your name and email with us. Your Google password never reaches this app.
      </p>
    </section>
  );
}
