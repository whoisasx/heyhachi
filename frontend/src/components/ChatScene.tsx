"use client";

import { MEADOW } from "@/lib/meadow";
import { type Scene, setScene, useScene } from "@/lib/scene";

/**
 * Experimental meadow backdrops for the chat page. Pick one with the switcher;
 * once we settle on a look, the switcher goes away.
 *  - horizon: the meadow rises from the bottom; the chat box sits on the grass
 *  - glass: the meadow shows only through a frosted chat box, with a green glow beneath it
 *  - ambient: the whole page has a faint, soft meadow behind everything
 */
export function ChatScene({ scene }: { scene: Scene }) {
  if (scene === "horizon")
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[42vh]" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={MEADOW} alt="" className="scene-horizon h-full w-full object-cover object-[50%_75%]" />
      </div>
    );
  if (scene === "glass")
    return <div className="scene-glow pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-64" aria-hidden />;
  if (scene === "ambient")
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={MEADOW} alt="" aria-hidden className="scene-ambient pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover" />
    );
  return null;
}

/** The meadow inside the chat box, for the "glass" look. */
export function GlassFill() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={MEADOW} alt="" aria-hidden className="scene-glass pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover object-[50%_80%]" />
  );
}

const OPTIONS: { id: Scene; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "horizon", label: "1 · Horizon" },
  { id: "glass", label: "2 · Glass" },
  { id: "ambient", label: "3 · Ambient" },
];

/** Temporary switcher to compare the looks. */
export function SceneSwitcher() {
  const scene = useScene();
  return (
    <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-full border border-border bg-surface/90 p-1 text-xs shadow-sm backdrop-blur">
      <span className="px-2 text-muted">Try a look</span>
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => setScene(o.id)}
          aria-pressed={scene === o.id}
          className={`rounded-full px-2.5 py-1 transition-colors ${scene === o.id ? "bg-foreground text-background" : "hover:bg-sunk"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
