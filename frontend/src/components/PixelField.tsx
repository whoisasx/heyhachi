"use client";

import { useEffect, useRef } from "react";

/**
 * Background for the sign-in demo: a twinkling dot grid, and a band of golden-hour
 * clouds whose top and bottom edges break up into slowly shifting pixel blocks.
 * Photo: Emerson Peters on Unsplash (Unsplash License), loaded from Unsplash's CDN.
 */
const PHOTO = "https://images.unsplash.com/photo-1519370159120-226cb8b70f88?auto=format&fit=crop&w=1600&q=70";
const CELL = 14;
const EDGE_ROWS = 5; // rows of pixel blocks on each edge of the band
const FRAME_MS = 140;

export function PixelField({ bandTop = 0.3, bandBottom = 0.7 }: { bandTop?: number; bandBottom?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let holes: boolean[][] = []; // [edgeRow][col] = hidden block
    let twinkle = new Map<number, number>(); // dot index -> brightness 0..1
    let pan = 0;
    let timer: ReturnType<typeof setInterval> | undefined;

    const photo = new Image();
    photo.crossOrigin = "anonymous";
    photo.decoding = "async";
    photo.src = PHOTO;

    const chance = (r: number) => 0.9 - (r / EDGE_ROWS) * 0.85; // outer rows mostly hidden, inner mostly shown

    const layout = () => {
      const box = el.parentElement!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = box.width;
      h = box.height;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / CELL);
      rows = Math.ceil(h / CELL);
      holes = Array.from({ length: EDGE_ROWS * 2 }, (_, i) =>
        Array.from({ length: cols }, () => Math.random() < chance(i % EDGE_ROWS)),
      );
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const top = Math.round((h * bandTop) / CELL) * CELL;
      const bottom = Math.round((h * bandBottom) / CELL) * CELL;

      // the photo band, slowly drifting sideways
      if (photo.complete && photo.naturalWidth) {
        const bandH = bottom - top;
        const scale = Math.max((w * 1.15) / photo.naturalWidth, bandH / photo.naturalHeight);
        const pw = photo.naturalWidth * scale;
        const ph = photo.naturalHeight * scale;
        const x = -((pw - w) / 2) * (1 + Math.sin(pan) * 0.9);
        ctx.globalAlpha = 0.9;
        ctx.drawImage(photo, x, top + (bandH - ph) / 2, pw, ph);
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, w, top);
        ctx.clearRect(0, bottom, w, h - bottom);
        // pixel blocks eaten out of both edges
        for (let r = 0; r < EDGE_ROWS; r++) {
          for (let c = 0; c < cols; c++) {
            if (holes[r][c]) ctx.clearRect(c * CELL, top + r * CELL, CELL, CELL);
            if (holes[EDGE_ROWS + r][c]) ctx.clearRect(c * CELL, bottom - (r + 1) * CELL, CELL, CELL);
          }
        }
      }

      // dot grid, with a few dots twinkling
      for (let r = 1; r < rows; r++) {
        const y = r * CELL;
        if (y > top && y < bottom) continue;
        for (let c = 1; c < cols; c++) {
          const glow = twinkle.get(r * cols + c) ?? 0;
          ctx.fillStyle = `rgba(190, 205, 255, ${0.09 + glow * 0.6})`;
          ctx.fillRect(c * CELL - 0.75, y - 0.75, 1.5, 1.5);
        }
      }
    };

    const step = () => {
      pan += 0.004;
      // reshuffle a few edge blocks
      for (let i = 0; i < Math.max(4, cols / 6); i++) {
        const r = Math.floor(Math.random() * EDGE_ROWS * 2);
        const c = Math.floor(Math.random() * cols);
        holes[r][c] = Math.random() < chance(r % EDGE_ROWS);
      }
      // fade twinkles, start new ones
      const next = new Map<number, number>();
      twinkle.forEach((v, k) => v > 0.05 && next.set(k, v * 0.86));
      for (let i = 0; i < 3; i++) next.set(Math.floor(Math.random() * rows * cols), 1);
      twinkle = next;
      draw();
    };

    layout();
    draw();
    photo.onload = draw;
    const resize = new ResizeObserver(() => {
      layout();
      draw();
    });
    resize.observe(el.parentElement!);
    if (!still) timer = setInterval(step, FRAME_MS);
    return () => {
      resize.disconnect();
      clearInterval(timer);
      photo.onload = null;
    };
  }, [bandTop, bandBottom]);

  return <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}
