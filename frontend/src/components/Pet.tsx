"use client";

import { useEffect, useRef, useState } from "react";

import { useRoam } from "@/lib/pet";

/**
 * Hachi, a small golden retriever.
 * - Normally sits on the top-right corner of the chat box.
 * - With "Let Hachi roam" on, walks over to sit beside the open chat in the sidebar,
 *   or wanders around the screen when no chat is open.
 * Pages mark the spots with data-pet="composer" and data-pet="active-chat".
 */

const W = 60;
const H = 45;
const SPEED = 0.15; // px per ms

type Face = 1 | -1;
type Spot = { x: number; y: number; face: Face };
interface View extends Spot {
  ms: number;
  walking: boolean;
  shown: boolean;
}

function visible(r: DOMRect) {
  return r.width > 0 && r.left >= 0 && r.top >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
}

/** Where Hachi should be right now: a spot, "wander", or null (nowhere to sit, so hide). */
function target(roam: boolean): Spot | "wander" | null {
  if (roam) {
    const row = document.querySelector<HTMLElement>('[data-pet="active-chat"]');
    const r = row?.getBoundingClientRect();
    if (r && visible(r)) return { x: r.right + 4, y: r.top + r.height / 2 - H + 9, face: -1 };
    return "wander";
  }
  const box = document.querySelector<HTMLElement>('[data-pet="composer"]');
  const r = box?.getBoundingClientRect();
  if (!r || !r.width) return null;
  return { x: r.right - W - 18, y: r.top - H + 4, face: -1 };
}

function randomSpot(): Spot {
  const pad = 16;
  return {
    x: pad + Math.random() * Math.max(0, window.innerWidth - W - 2 * pad),
    y: 70 + Math.random() * Math.max(0, window.innerHeight - H - 150),
    face: Math.random() < 0.5 ? 1 : -1,
  };
}

export function Pet() {
  const roam = useRoam();
  const [view, setView] = useState<View | null>(null);
  const [petted, setPetted] = useState(0);
  const at = useRef<Spot | null>(null); // where Hachi is (or is walking to)

  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer: ReturnType<typeof setTimeout>;
    let arrive: ReturnType<typeof setTimeout>;
    let restUntil = 0;

    const walk = (to: Spot) => {
      const from = at.current!;
      const dx = to.x - from.x;
      const dist = Math.hypot(dx, to.y - from.y);
      const ms = still ? 0 : Math.max(200, dist / SPEED);
      const heading: Face = Math.abs(dx) > 2 ? (dx > 0 ? 1 : -1) : from.face;
      at.current = to;
      setView({ ...to, face: heading, ms, walking: ms > 0, shown: true });
      clearTimeout(arrive);
      arrive = setTimeout(() => setView((v) => v && { ...v, walking: false, face: to.face, ms: 0 }), ms);
      return ms;
    };

    const tick = () => {
      const t = target(roam);
      if (t === null) {
        at.current = null;
        setView((v) => v && { ...v, shown: false, walking: false });
      } else if (at.current === null) {
        // appear in place, then carry on
        const spot = t === "wander" ? randomSpot() : t;
        at.current = spot;
        restUntil = Date.now() + 1500;
        setView({ ...spot, ms: 0, walking: false, shown: true });
      } else if (t === "wander") {
        if (Date.now() >= restUntil) restUntil = Date.now() + walk(randomSpot()) + 2000 + Math.random() * 4000;
      } else if (Math.hypot(t.x - at.current.x, t.y - at.current.y) > 3) {
        restUntil = 0;
        walk(t);
      }
      timer = setTimeout(tick, 500);
    };

    tick();
    return () => {
      clearTimeout(timer);
      clearTimeout(arrive);
    };
  }, [roam]);

  useEffect(() => {
    if (!petted) return;
    const t = setTimeout(() => setPetted(0), 1200);
    return () => clearTimeout(t);
  }, [petted]);

  if (!view) return null;
  return (
    <div
      className={`pet ${view.walking ? "pet-walking" : ""} ${petted ? "pet-petted" : ""}`}
      style={{
        translate: `${view.x}px ${view.y}px`,
        transitionDuration: `${view.ms}ms, 300ms`,
        opacity: view.shown ? 1 : 0,
      }}
      aria-hidden
    >
      {petted > 0 && (
        <span key={petted} className="pet-heart">
          ♥
        </span>
      )}
      <svg
        width={W}
        height={H}
        viewBox="0 0 64 48"
        className={view.face === -1 ? "pet-flip" : ""}
        onClick={() => setPetted(Date.now())}
      >
        <title>Hachi</title>
        {view.walking ? <Standing /> : <Sitting />}
      </svg>
    </div>
  );
}

const FUR = "#d99a3e";
const SHADE = "#b77a2a";
const LIGHT = "#f2cd85";
const DARK = "#2b1d12";
const COLLAR = "#2f5bea";

function Head({ x, y }: { x: number; y: number }) {
  // head centred at (x, y), facing right
  return (
    <>
      <circle cx={x} cy={y} r="8" fill={FUR} />
      <ellipse cx={x + 7} cy={y + 3} rx="5.5" ry="3.6" fill={LIGHT} />
      <ellipse cx={x + 12} cy={y + 1.8} rx="1.7" ry="1.4" fill={DARK} />
      <path d={`M${x + 8} ${y + 5.5}q2 1 3.5 0`} stroke={DARK} strokeWidth=".8" fill="none" strokeLinecap="round" />
      <circle className="pet-eye" cx={x + 3} cy={y - 2.5} r="1.3" fill={DARK} />
      <ellipse cx={x - 4} cy={y + 2} rx="3.6" ry="6.5" fill={SHADE} transform={`rotate(18 ${x - 4} ${y + 2})`} />
      <path d={`M${x - 8.5} ${y + 4}q3.5 5 7 2.5`} stroke={COLLAR} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <circle cx={x - 4} cy={y + 8.5} r="1.3" fill="#ffd166" />
    </>
  );
}

function Standing() {
  const leg = (x: number, fill: string, cls: string) => (
    <rect className={cls} x={x} y="29" width="5" height="16" rx="2.5" fill={fill} />
  );
  return (
    <g>
      <path className="pet-tail" style={{ transformOrigin: "15px 24px" }} d="M15 24C9 22 6 17 4 13" stroke={SHADE} strokeWidth="4.5" fill="none" strokeLinecap="round" />
      {leg(16, SHADE, "pet-leg-a")}
      {leg(39, SHADE, "pet-leg-b")}
      <ellipse cx="30" cy="26" rx="17" ry="9" fill={FUR} />
      <path d="M18 31q12 6 24 0" stroke={LIGHT} strokeWidth="3" fill="none" strokeLinecap="round" />
      {leg(21, FUR, "pet-leg-b")}
      {leg(44, FUR, "pet-leg-a")}
      <ellipse cx="44" cy="21" rx="7" ry="9.5" fill={FUR} />
      <ellipse cx="47" cy="25" rx="3.5" ry="5" fill={LIGHT} />
      <Head x={50} y={13} />
    </g>
  );
}

function Sitting() {
  return (
    <g>
      <path className="pet-tail" style={{ transformOrigin: "16px 43px" }} d="M16 43C10 44 6 42 4 38" stroke={SHADE} strokeWidth="4.5" fill="none" strokeLinecap="round" />
      <ellipse cx="25" cy="37" rx="11" ry="8.5" fill={FUR} />
      <rect x="37" y="30" width="4.5" height="16" rx="2.2" fill={SHADE} />
      <ellipse cx="35" cy="27" rx="8.5" ry="13" fill={FUR} transform="rotate(28 35 27)" />
      <ellipse cx="41" cy="26" rx="3.5" ry="7" fill={LIGHT} transform="rotate(20 41 26)" />
      <ellipse cx="31" cy="45" rx="5.5" ry="2.2" fill={SHADE} />
      <rect x="41.5" y="30" width="4.5" height="16" rx="2.2" fill={FUR} />
      <Head x={43} y={11} />
      <ellipse cx="51" cy="18.6" rx="1.4" ry="2" fill="#f07f8f" />
    </g>
  );
}
