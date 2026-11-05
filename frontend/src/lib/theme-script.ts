// Plain module (no "use client"), so the server layout can inline the script text.

export const THEME_KEY = "theme";
export const BACKDROP_KEY = "backdrop";

/**
 * Runs in <head> before the page paints, so there's no flash of the wrong theme
 * or background. Keep it in sync with apply() / applyBackdrop() in theme.ts.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var e=document.documentElement;var p=localStorage.getItem("${THEME_KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);e.dataset.theme=d?"dark":"light";e.dataset.backdrop=localStorage.getItem("${BACKDROP_KEY}")==="hachi"?"hachi":"paper"}catch(x){}})()`;
