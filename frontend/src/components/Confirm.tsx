import { useCallback, useEffect, useRef, useState } from "react";

interface Ask {
  title: string;
  body?: string;
  confirmLabel?: string;
}

/**
 * An in-app "are you sure?" box for actions that can't be undone.
 * `const [dialog, confirm] = useConfirm();` then `if (await confirm({...}))`, and render `{dialog}`.
 */
export function useConfirm(): [React.ReactNode, (ask: Ask) => Promise<boolean>] {
  const [ask, setAsk] = useState<Ask | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((next: Ask) => {
    resolver.current?.(false);
    setAsk(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setAsk(null);
  }, []);

  useEffect(() => {
    if (!ask) return;
    confirmButton.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ask, close]);

  const dialog = ask && (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={() => close(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-[0_24px_64px_rgba(0,0,0,0.25)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="font-semibold">
          {ask.title}
        </h2>
        {ask.body && <p className="mt-1.5 text-sm text-muted">{ask.body}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => close(false)}>
            Cancel
          </button>
          <button ref={confirmButton} className="btn bg-danger text-white hover:opacity-90" onClick={() => close(true)}>
            {ask.confirmLabel ?? "Remove"}
          </button>
        </div>
      </div>
    </div>
  );

  return [dialog, confirm];
}
