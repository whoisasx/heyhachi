"use client";

import { useEffect, useRef, useState } from "react";

const KEY = "hachi:live-width";
const MIN = 320;
const DEFAULT = 432;
const maxWidth = () => Math.max(MIN, Math.round(window.innerWidth * 0.65));

function savedWidth() {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n >= MIN ? n : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/**
 * The live browser beside the chat. Drag its left edge (or use the arrow keys on it)
 * to make it wider or narrower; the width is remembered in this browser.
 */
export function LivePanel({
  url,
  site,
  onStop,
  stopping,
}: {
  url: string;
  site?: string;
  onStop?: () => void;
  stopping?: boolean;
}) {
  const [width, setWidth] = useState(DEFAULT);
  const [dragging, setDragging] = useState(false);
  const latest = useRef(width);

  useEffect(() => {
    const w = Math.min(savedWidth(), maxWidth());
    latest.current = w;
    setWidth(w); // eslint-disable-line react-hooks/set-state-in-effect -- read the saved width after mount
  }, []);

  const resize = (w: number) => {
    const next = Math.round(Math.min(Math.max(w, MIN), maxWidth()));
    latest.current = next;
    setWidth(next);
  };
  const save = () => {
    try {
      localStorage.setItem(KEY, String(latest.current));
    } catch {
      // storage blocked: the width just isn't remembered
    }
  };

  return (
    <aside className="relative hidden shrink-0 flex-col border-l border-border bg-sunk xl:flex" style={{ width }}>
      {/* the handle: drag to resize */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the live browser"
        aria-valuemin={MIN}
        aria-valuenow={width}
        tabIndex={0}
        className="group absolute -left-2 top-0 z-10 flex h-full w-4 cursor-col-resize items-center justify-center outline-none"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
        }}
        onPointerMove={(e) => dragging && resize(window.innerWidth - e.clientX)}
        onPointerUp={() => {
          setDragging(false);
          save();
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          resize(latest.current + (e.key === "ArrowLeft" ? 32 : -32));
          save();
        }}
      >
        <span
          className={`h-12 w-1.5 rounded-full transition-colors ${
            dragging ? "bg-accent" : "bg-border group-hover:bg-foreground/40 group-focus-visible:bg-accent"
          }`}
        />
      </div>

      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
        <span className="min-w-0">
          <span className="block text-sm font-medium">Hachi is browsing</span>
          {site && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                <path d="M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z" />
              </svg>
              <span className="truncate">{site}</span>
            </span>
          )}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-md px-2 py-1 text-xs text-muted hover:bg-sunk hover:text-foreground">
            New tab ↗
          </a>
          {onStop && (
            <button
              type="button"
              onClick={onStop}
              disabled={stopping}
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium hover:border-danger hover:text-danger disabled:opacity-50"
            >
              <span className="h-2 w-2 rounded-[2px] bg-current" aria-hidden />
              {stopping ? "Stopping…" : "Stop"}
            </button>
          )}
        </span>
      </div>
      <div className="p-4">
        <iframe
          src={url}
          title="Live browser"
          // while dragging, the iframe would swallow the mouse and stop the resize
          className={`aspect-[4/3] w-full rounded-xl border border-border bg-surface ${dragging ? "pointer-events-none" : ""}`}
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
        <p className="mt-3 text-xs text-muted">You can click and type in this browser to help. Drag its left edge to resize.</p>
      </div>
    </aside>
  );
}
