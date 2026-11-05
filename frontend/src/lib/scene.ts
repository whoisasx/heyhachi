import { useSyncExternalStore } from "react";

/**
 * Experimental: which meadow look the chat page uses, so the options can be compared.
 * "off" | "horizon" | "glass" | "ambient". Remembered per browser.
 */
export type Scene = "off" | "horizon" | "glass" | "ambient";
const KEY = "hachi:scene";
const EVENT = "hachi:scene";
let memory: Scene = "off";

function read(): Scene {
  try {
    return (localStorage.getItem(KEY) as Scene | null) ?? memory;
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

export function setScene(scene: Scene) {
  memory = scene;
  try {
    localStorage.setItem(KEY, scene);
  } catch {
    // storage blocked: keep it for this visit only
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useScene(): Scene {
  return useSyncExternalStore(subscribe, read, () => "off");
}
