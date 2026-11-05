"use client";

import { type ReactNode, useEffect, useState } from "react";

/**
 * A cloud browser's live view, embedded in the page. "Expand" lifts it into a large
 * panel (about 80% of the screen) over a blurred page; "Close" puts it back.
 * The iframe is never moved in the DOM, so expanding doesn't reload the browser.
 */
export function LiveView({ url, title, actions }: { url: string; title: string; actions?: ReactNode }) {
  const [big, setBig] = useState(false);

  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setBig(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [big]);

  return (
    <div className="relative">
      {/* keeps the page from jumping while the view is expanded */}
      {big && (
        <div className="grid aspect-video w-full place-items-center rounded-lg border border-dashed border-border text-xs text-muted">
          Open in the larger view
        </div>
      )}
      {big && <div className="fixed inset-0 z-[55] bg-black/35 backdrop-blur-sm" onMouseDown={() => setBig(false)} aria-hidden />}

      <div
        role={big ? "dialog" : undefined}
        aria-modal={big || undefined}
        aria-label={big ? title : undefined}
        className={
          big
            ? "fixed left-1/2 top-1/2 z-[60] flex h-[80vh] w-[80vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_30px_90px_rgba(0,0,0,0.35)]"
            : "flex flex-col overflow-hidden rounded-lg border border-border bg-surface"
        }
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            {title}
          </span>
          <span className="ml-auto flex items-center gap-2">
            {big && actions}
            <button
              type="button"
              onClick={() => setBig(!big)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-foreground/80 hover:bg-sunk"
              aria-label={big ? "Close the larger view" : "Expand"}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {big ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />}
              </svg>
              {big ? "Close" : "Expand"}
            </button>
          </span>
        </div>
        <iframe
          src={url}
          title={title}
          className={big ? "min-h-0 w-full flex-1" : "aspect-video w-full"}
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>
    </div>
  );
}
