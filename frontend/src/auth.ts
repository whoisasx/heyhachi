import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

// Dev-only sign-in without Google, so the app can be tried locally before the
// OAuth client exists. Never available in a production build.
export const devLoginEnabled =
  process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_LOGIN === "1";

const devLogin = Credentials({
  id: "dev",
  name: "Dev login",
  credentials: { email: { label: "Email", type: "email" } },
  authorize: async (credentials) => {
    const email = String(credentials?.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
    return { id: `dev:${email}`, email, name: email.split("@")[0] };
  },
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google, ...(devLoginEnabled ? [devLogin] : [])],
  session: { strategy: "jwt" },
  pages: { signIn: "/" },
  callbacks: {
    jwt({ token, account, profile, user }) {
      if (account) {
        // Google's `sub` is the stable user id the backend keys users on.
        token.uid =
          account.provider === "google"
            ? String(profile?.sub ?? account.providerAccountId)
            : String(user?.id);
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = String(token.uid ?? token.sub);
      return session;
    },
  },
});
