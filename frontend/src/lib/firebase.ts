"use client";

import type { ConfirmationResult, RecaptchaVerifier } from "firebase/auth";

/**
 * Phone verification with Firebase Phone Auth. Firebase is used only to send and
 * check the SMS code; the app's sign-in stays Google (Auth.js). The Firebase
 * session is signed out as soon as the backend has the proof.
 * These config values are public by design (they identify the project, not secrets).
 */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const phoneVerificationConfigured = Boolean(config.apiKey && config.projectId);

// Local testing only: with Firebase test numbers (fixed code, no SMS) this skips the
// reCAPTCHA. Firebase refuses real numbers while it is on, so it can't be abused.
const testMode = process.env.NEXT_PUBLIC_FIREBASE_TEST_PHONES === "1";

// Loaded on demand, so pages that don't verify a phone don't download Firebase.
async function getAuth() {
  const [{ getApps, initializeApp }, auth] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);
  const app = getApps()[0] ?? initializeApp(config);
  const a = auth.getAuth(app);
  if (testMode) a.settings.appVerificationDisabledForTesting = true;
  return { auth: a, lib: auth };
}

let verifier: RecaptchaVerifier | null = null;

/** Sends the SMS code. `containerId` is an empty element for the invisible reCAPTCHA. */
export async function sendCode(phone: string, containerId: string): Promise<ConfirmationResult> {
  const { auth, lib } = await getAuth();
  verifier?.clear();
  // A fresh element each time: clear() leaves the old one unusable for a retry.
  const host = document.getElementById(containerId);
  if (!host) throw new Error(`#${containerId} is missing`);
  host.replaceChildren();
  const box = document.createElement("div");
  host.appendChild(box);
  verifier = new lib.RecaptchaVerifier(auth, box, { size: "invisible" });
  try {
    return await lib.signInWithPhoneNumber(auth, phone, verifier);
  } catch (err) {
    verifier.clear();
    verifier = null;
    throw err;
  }
}

/** Checks the code and returns a short-lived proof (Firebase ID token) for the backend. */
export async function confirmCode(confirmation: ConfirmationResult, code: string): Promise<string> {
  const { user } = await confirmation.confirm(code);
  const token = await user.getIdToken();
  const { auth, lib } = await getAuth();
  await lib.signOut(auth); // we only needed the proof
  verifier?.clear();
  verifier = null;
  return token;
}

const MESSAGES: Record<string, string> = {
  "auth/invalid-phone-number": "That number doesn't look right. Include the country code.",
  "auth/missing-phone-number": "Enter your phone number.",
  "auth/too-many-requests": "Too many tries. Wait a bit and try again.",
  "auth/quota-exceeded": "Today's free SMS limit is used up. Try again tomorrow.",
  "auth/invalid-verification-code": "That code isn't right.",
  "auth/code-expired": "That code expired. Send a new one.",
  "auth/captcha-check-failed": "The robot check failed. Reload and try again.",
  "auth/operation-not-allowed": "Phone verification isn't available for this country yet.",
  "auth/billing-not-enabled": "SMS needs billing switched on in Firebase.",
  "auth/network-request-failed": "Network problem. Check your connection.",
};

export function firebaseMessage(err: unknown): string {
  const code = (err as { code?: string })?.code;
  console.warn("[phone] verification error", code, err); // code only; never the number
  return (code && MESSAGES[code]) || "Couldn't verify the number. Try again.";
}
