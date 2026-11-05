import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { auth, devLoginEnabled, signIn } from "@/auth";
import { AgentDemo } from "@/components/AgentDemo";

export default function Home() {
  return (
    <main className="grid min-h-full flex-1 lg:grid-cols-[1.15fr_1fr]">
      <section className="hidden lg:block" aria-hidden>
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
        <span className="display grid h-14 w-14 place-items-center rounded-2xl bg-foreground text-2xl text-background shadow-[0_12px_40px_rgba(47,91,234,0.25)]">
          B
        </span>

        <h1 className="display mt-8 text-[2.6rem] leading-[1.05] sm:text-5xl">
          Get it done
          <br />
          <span className="text-accent">on any website.</span>
        </h1>
        <p className="mt-5 max-w-sm leading-relaxed text-muted">
          Tell the assistant what you need. It works in a real browser, and keeps your logins, codes
          and keys out of the chat.
        </p>

        <form
          className="mt-9"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/chat" });
          }}
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-accent px-4 py-3.5 font-medium text-white shadow-[0_4px_0_rgba(0,0,0,0.18)] transition hover:brightness-110 active:translate-y-px active:shadow-none dark:text-[#0d1533]"
          >
            <span className="grid h-6 w-6 place-items-center rounded-full bg-white">
              <GoogleMark />
            </span>
            Continue with Google
          </button>
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

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
