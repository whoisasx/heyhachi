// Plain module (no "use client"), so the server layout can inline the script text.

export const THEME_KEY = "theme";

/**
 * Runs in <head> before the page paints, so there's no flash of the wrong theme.
 * Keep it in sync with apply() in theme.ts.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}})()`;
