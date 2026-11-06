import { useSyncExternalStore } from "react";

/**
 * Hachi (the pet) settings, remembered per browser:
 * - shown: whether Hachi is on screen at all (default on);
 * - roam: whether it roams around instead of sitting on the chat box (default off).
 */
const EVENT = "hachi:pet";
const memory: Record<string, boolean> = {}; // used when the browser blocks storage

function store(key: string, fallback: boolean) {
  const read = (): boolean => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? (memory[key] ?? fallback) : v === "1";
    } catch {
      return memory[key] ?? fallback;
    }
  };
  const set = (on: boolean) => {
    memory[key] = on;
    try {
      localStorage.setItem(key, on ? "1" : "0");
    } catch {
      // storage blocked: the in-memory value still works for this visit
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return { read, set };
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const shown = store("hachi:on", true);
const roam = store("hachi:roam", false);

export const setPetShown = shown.set;
export const setRoam = roam.set;

export function usePetShown(): boolean {
  return useSyncExternalStore(subscribe, shown.read, () => true);
}

export function useRoam(): boolean {
  return useSyncExternalStore(subscribe, roam.read, () => false);
}
