"use client";

import { useSyncExternalStore } from "react";

import { THEME_KEY as KEY } from "./theme-script";

export type ThemePref = "system" | "light" | "dark";

const CHANGED = "theme:changed";

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** Same logic as THEME_BOOT_SCRIPT in theme-script.ts. */
function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function setTheme(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // storage blocked: still switch for this page view
  }
  apply(pref);
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  const media = matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => {
    if (read() === "system") apply("system");
    onChange();
  };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onSystem); // another tab changed it
  media.addEventListener("change", onSystem);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onSystem);
    media.removeEventListener("change", onSystem);
  };
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, read, () => "system");
}
