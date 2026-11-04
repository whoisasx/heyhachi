import { SignJWT } from "jose";
import { NextResponse } from "next/server";

import { auth } from "@/auth";

const TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Short-lived token the browser sends to the FastAPI backend (docs/API.md §2).
 * Signed with BACKEND_JWT_SECRET, which only this server and the backend know.
 */
export async function GET() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const secret = process.env.BACKEND_JWT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "BACKEND_JWT_SECRET is not set" }, { status: 500 });
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    email: user.email,
    name: user.name ?? undefined,
    picture: user.image ?? undefined,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setAudience("browser-agent-api")
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));

  return NextResponse.json(
    { token, expires_at: (now + TOKEN_TTL_SECONDS) * 1000 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
