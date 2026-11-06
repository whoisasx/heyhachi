import { useEffect } from "react";

/**
 * While a live browser is shown large (expanded or full screen), mark the page so it
 * sits above everything else: the chat column is its own layer (`isolate`), so a high
 * z-index inside it would still lose to the sidebar and to Hachi (see globals.css).
 */
let open = 0;

export function useLiftOverlay(on: boolean) {
  useEffect(() => {
    if (!on) return;
    open += 1;
    document.documentElement.dataset.liveBig = "";
    return () => {
      open -= 1;
      if (open === 0) delete document.documentElement.dataset.liveBig;
    };
  }, [on]);
}
