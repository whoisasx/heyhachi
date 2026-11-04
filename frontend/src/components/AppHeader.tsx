import Link from "next/link";

import { signOut } from "@/auth";

export function AppHeader({ email, active }: { email: string; active: "chat" | "accounts" }) {
  const tab = (href: string, label: string, key: string) => (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-sm ${
        active === key ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-2">
      <div className="flex items-center gap-4">
        <span className="font-semibold">Browser Agent</span>
        <nav className="flex gap-1">
          {tab("/chat", "Chat", "chat")}
          {tab("/accounts", "Connected accounts", "accounts")}
        </nav>
      </div>
      <form
        className="flex items-center gap-3"
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <span className="hidden text-sm text-muted sm:inline">{email}</span>
        <button type="submit" className="btn-ghost py-1.5">
          Sign out
        </button>
      </form>
    </header>
  );
}
