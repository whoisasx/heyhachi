"use client";

import { useEffect, useRef, useState } from "react";

import { useRoam } from "@/lib/pet";

/**
 * Hachi, a golden retriever (drawings in public/pet, made by scripts/pet.py).
 * - Normally sits on the top-right corner of the chat box, facing you.
 * - With "Let Hachi roam" on, walks to sit beside the open chat in the sidebar,
 *   or wanders around the screen when no chat is open.
 * It walks slowly, only straight across or straight up/down, and leaves a faint sparkle trail.
 * Pages mark the spots with data-pet="composer" and data-pet="active-chat".
 */

type Pose = "sit" | "front" | "side";
type Face = 1 | -1;
interface Spot {
  x: number; // where the paws touch the ground
  y: number;
  scale: number;
}
interface View extends Spot {
  pose: Pose;
  face: Face;
  ms: number;
  shown: boolean;
}

const SRC: Record<Pose, string> = { sit: "/pet/sit.svg", front: "/pet/walk-front.svg", side: "/pet/walk-side.svg" };
// width, height, and how far down the picture the paws are
const BOX: Record<Pose, [number, number, number]> = {
  sit: [64, 64, 114 / 120],
  front: [64, 64, 114 / 120],
  side: [90, 63, 95 / 100],
};
const SPEED = 45; // px per second: an easy stroll
const REST = [3000, 8000]; // ms to sit between wanders

function onScreen(r: DOMRect) {
  return r.width > 0 && r.left >= 0 && r.top >= 40 && r.bottom <= window.innerHeight && r.right + 50 <= window.innerWidth;
}

/** A strip Hachi strolls along, side to side. */
interface Pace {
  x1: number;
  x2: number;
  y: number;
  scale: number;
}

/**
 * Where Hachi should be: a spot, a strip to pace, "wander", or null (nowhere to be, so hide).
 * On the chat page: the chat box, or (roaming) beside the open chat / anywhere.
 * Elsewhere (Vault, Profile): on top of the "Let Hachi roam" switch, pacing along it when roaming.
 */
function target(roam: boolean): Spot | Pace | "wander" | null {
  const box = document.querySelector('[data-pet="composer"]')?.getBoundingClientRect();
  if (box && box.width) {
    if (!roam) return { x: box.right - 52, y: box.top + 3, scale: 1 };
    const r = document.querySelector('[data-pet="active-chat"]')?.getBoundingClientRect();
    if (r && onScreen(r)) return { x: r.right + 24, y: r.bottom + 1, scale: 0.72 };
    return "wander";
  }
  const sw = document.querySelector('[data-pet="switch"]')?.getBoundingClientRect();
  if (!sw || !sw.width || sw.left < 0) return null; // phone menu closed
  const y = sw.top + 2;
  if (!roam) return { x: sw.left + 72, y, scale: 0.72 };
  return { x1: sw.left + 28, x2: sw.right - 28, y, scale: 0.72 };
}

function randomSpot(): Spot {
  return {
    x: 60 + Math.random() * Math.max(0, window.innerWidth - 120),
    y: 120 + Math.random() * Math.max(0, window.innerHeight - 180),
    scale: 1,
  };
}

/** Somewhere along the strip, a fair way from where Hachi is now. */
function paceSpot(p: Pace, fromX?: number): Spot {
  const mid = (p.x1 + p.x2) / 2;
  const half = Math.max(0, (p.x2 - p.x1) / 2);
  // head for the other half of the strip, so every stroll is a real one
  const start = fromX === undefined ? p.x1 : fromX < mid ? mid : p.x1;
  return { x: start + Math.random() * half, y: p.y, scale: p.scale };
}

const far = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) > 3 || Math.abs(a.y - b.y) > 3;

export function Pet() {
  const roam = useRoam();
  const [view, setView] = useState<View | null>(null);
  const [petted, setPetted] = useState(0);
  const [sparkles, setSparkles] = useState<{ id: number; x: number; y: number }[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const face = useRef<Face>(1);

  /** Where Hachi actually is right now, even mid-walk. */
  const now = () => {
    const el = box.current;
    if (!el) return null;
    const [x, y] = getComputedStyle(el).translate.split(" ").map(parseFloat);
    return Number.isFinite(x) ? { x, y: Number.isFinite(y) ? y : 0 } : null;
  };

  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let loop: ReturnType<typeof setTimeout>;
    let steps: ReturnType<typeof setTimeout>[] = [];
    let goal: Spot | null = null;
    let mode: "wander" | "pace" | null = null; // strolling about rather than sitting at a spot
    let restUntil = 0;
    let shown = false;

    /** Walk to a spot: first straight across, then straight up or down. Returns the time it takes. */
    const walk = (to: Spot) => {
      steps.forEach(clearTimeout);
      steps = [];
      const from = now() ?? to;
      const legs: Omit<View, "ms" | "shown">[] = [];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if (Math.abs(dx) > 2) {
        face.current = dx > 0 ? 1 : -1;
        legs.push({ x: to.x, y: from.y, scale: to.scale, pose: "side", face: face.current });
      }
      if (Math.abs(dy) > 2) legs.push({ x: to.x, y: to.y, scale: to.scale, pose: dy > 0 ? "front" : "side", face: face.current });

      let delay = 0;
      let at = from;
      for (const leg of legs) {
        const ms = still ? 0 : (Math.hypot(leg.x - at.x, leg.y - at.y) / SPEED) * 1000;
        steps.push(setTimeout(() => setView({ ...leg, ms, shown: true }), delay));
        delay += ms;
        at = leg;
      }
      steps.push(setTimeout(() => setView((v) => v && { ...v, pose: "sit", ms: 0, scale: to.scale }), delay));
      return delay;
    };

    const tick = () => {
      const t = target(roam);
      if (t === null) {
        if (shown) {
          steps.forEach(clearTimeout);
          setView((v) => v && { ...v, shown: false, pose: "sit", ms: 0 });
        }
        shown = false;
        goal = null;
      } else if (!shown) {
        const spot = t === "wander" ? randomSpot() : "x1" in t ? paceSpot(t) : t;
        shown = true;
        goal = spot;
        mode = t === "wander" ? "wander" : "x1" in t ? "pace" : null;
        restUntil = Date.now() + 2500;
        setView({ ...spot, pose: "sit", face: face.current, ms: 0, shown: true });
      } else if (t === "wander" || "x1" in t) {
        const next = t === "wander" ? "wander" : "pace";
        if (mode !== next || Date.now() >= restUntil) {
          mode = next;
          goal = t === "wander" ? randomSpot() : paceSpot(t, now()?.x);
          restUntil = Date.now() + walk(goal) + REST[0] + Math.random() * (REST[1] - REST[0]);
        }
      } else if (mode || !goal || far(goal, t)) {
        mode = null;
        goal = t;
        walk(t);
      }
      loop = setTimeout(tick, 600);
    };

    tick();
    return () => {
      clearTimeout(loop);
      steps.forEach(clearTimeout);
    };
  }, [roam]);

  // a faint sparkle trail while walking
  const walking = !!view && view.shown && view.pose !== "sit";
  useEffect(() => {
    if (!walking || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const add = setInterval(() => {
      const p = now();
      if (!p) return;
      const id = Date.now() + Math.random();
      setSparkles((s) => [...s.slice(-8), { id, x: p.x + (Math.random() - 0.5) * 30, y: p.y - 4 - Math.random() * 14 }]);
      setTimeout(() => setSparkles((s) => s.filter((k) => k.id !== id)), 2200);
    }, 520);
    return () => clearInterval(add);
  }, [walking]);

  useEffect(() => {
    if (!petted) return;
    const t = setTimeout(() => setPetted(0), 1200);
    return () => clearTimeout(t);
  }, [petted]);

  if (!view) return null;
  const [w, h, feet] = BOX[view.pose];
  return (
    <>
      {sparkles.map((s) => (
        <span key={s.id} className="pet-sparkle" style={{ left: s.x, top: s.y }} aria-hidden>
          ✦
        </span>
      ))}
      <div
        ref={box}
        className={`pet ${petted ? "pet-petted" : ""}`}
        style={{
          translate: `${view.x}px ${view.y}px`,
          transitionDuration: `${view.ms}ms, 400ms`,
          opacity: view.shown ? 1 : 0,
        }}
        aria-hidden
      >
        <div className="pet-body" style={{ scale: String(view.scale) }}>
          {petted > 0 && (
            <span key={petted} className="pet-heart">
              ♥
            </span>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny animated SVGs; next/image would strip the animation */}
          <img
            src={SRC[view.pose]}
            alt="Hachi"
            title="Hachi"
            width={w}
            height={h}
            draggable={false}
            onClick={() => setPetted(Date.now())}
            style={{ left: -w / 2, top: -h * feet, scale: view.face === -1 && view.pose === "side" ? "-1 1" : undefined }}
          />
        </div>
      </div>
      {/* load every pose up front so switching never flickers */}
      <div hidden>
        {Object.values(SRC).map((s) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={s} src={s} alt="" />
        ))}
      </div>
    </>
  );
}
