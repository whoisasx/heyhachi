import { useSyncExternalStore } from "react";

/** Whether Hachi (the pet) roams around. Remembered per browser. */
const KEY = "hachi:roam";
const EVENT = "hachi:roam";
let memory = false; // used when the browser blocks storage

function read(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? memory : v === "1";
  } catch {
    return memory;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function setRoam(on: boolean) {
  memory = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // storage blocked: the in-memory value still works for this visit
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useRoam(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
