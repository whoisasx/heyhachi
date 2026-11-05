"use client";

import { useSyncExternalStore } from "react";

import { BACKDROP_KEY, THEME_KEY as KEY } from "./theme-script";

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

// ---- background: "paper" (default) or "hachi" (dawn meadow) -------------------

export type Backdrop = "paper" | "hachi";
const BACKDROP_CHANGED = "backdrop:changed";

function readBackdrop(): Backdrop {
  try {
    return localStorage.getItem(BACKDROP_KEY) === "hachi" ? "hachi" : "paper";
  } catch {
    return "paper";
  }
}

export function setBackdrop(b: Backdrop) {
  try {
    if (b === "paper") localStorage.removeItem(BACKDROP_KEY);
    else localStorage.setItem(BACKDROP_KEY, b);
  } catch {
    // storage blocked: still switch for this page view
  }
  document.documentElement.dataset.backdrop = b;
  window.dispatchEvent(new Event(BACKDROP_CHANGED));
}

function subscribeBackdrop(onChange: () => void) {
  const onOther = () => {
    document.documentElement.dataset.backdrop = readBackdrop(); // another tab changed it
    onChange();
  };
  window.addEventListener(BACKDROP_CHANGED, onChange);
  window.addEventListener("storage", onOther);
  return () => {
    window.removeEventListener(BACKDROP_CHANGED, onChange);
    window.removeEventListener("storage", onOther);
  };
}

export function useBackdrop(): Backdrop {
  return useSyncExternalStore(subscribeBackdrop, readBackdrop, () => "paper");
}
