import { MEADOW } from "@/lib/meadow";

/* The meadow from the sign-in page, very faint inside the chat box so the app stays calm. */

/** Inside the chat box, blurred like frosted glass. */
export function BoxMeadow() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={MEADOW} alt="" aria-hidden className="chat-meadow-box pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover object-[50%_80%]" />
  );
}
