"use client";

import { useEffect, useRef } from "react";

/**
 * The hero backdrop, drawn on the same pixel grid language as the mascot:
 * a dithered night sky with twinkling stars over a field of pixel fire in the
 * brand's ice palette (the pixel-flames asset, animated). The pointer fans the
 * flames; when someone pulls the mascot's rug (`safu:rug`), the fire flares red.
 */

const CELL = 8; // screen px per scene pixel
const MAX = 36;

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function ramp(stops: [number, string][]): RGB[] {
  const out: RGB[] = [];
  for (let i = 0; i <= MAX; i++) {
    let k = 0;
    while (k < stops.length - 2 && i > stops[k + 1][0]) k++;
    const [i0, c0] = stops[k], [i1, c1] = stops[k + 1];
    const t = Math.min(1, Math.max(0, (i - i0) / (i1 - i0)));
    const a = hex(c0), b = hex(c1);
    out.push([0, 1, 2].map((j) => Math.round(a[j] + (b[j] - a[j]) * t)) as RGB);
  }
  return out;
}

const ICE = ramp([
  [0, "#0a0a0a"],
  [6, "#15181f"],
  [13, "#2a303c"],
  [20, "#4f596c"],
  [27, "#7f8ba3"],
  [32, "#b9c3d6"],
  [36, "#f2f2f2"],
]);
const RED = ramp([
  [0, "#0a0a0a"],
  [6, "#1f0c0b"],
  [13, "#4d1411"],
  [20, "#9c2219"],
  [27, "#ff3b30"],
  [32, "#ff8a80"],
  [36, "#fff1ef"],
]);
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export default function PixelScene({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let cols = 0, rows = 0, fireTop = 0, fireRows = 0;
    let fire = new Uint8Array(0);
    let sky: Uint8ClampedArray = new Uint8ClampedArray(0);
    let img: ImageData;
    let stars: { x: number; y: number; p: number; s: number }[] = [];
    const pointer = { x: -1, y: -1 };
    let red = 0; // 0..1 blend toward the red ramp
    let redTarget = 0;

    const build = () => {
      const r = canvas.getBoundingClientRect();
      cols = Math.max(1, Math.ceil(r.width / CELL));
      rows = Math.max(1, Math.ceil(r.height / CELL));
      canvas.width = cols;
      canvas.height = rows;
      fireRows = Math.floor(rows * 0.55);
      fireTop = rows - fireRows;
      fire = new Uint8Array(cols * fireRows);
      for (let x = 0; x < cols; x++) fire[(fireRows - 1) * cols + x] = MAX;
      img = ctx.createImageData(cols, rows);

      // sky: two-tone ordered dither, darker at the top
      sky = new Uint8ClampedArray(cols * rows * 4);
      const top = hex("#0a0a0a"), low = hex("#141821");
      for (let y = 0; y < rows; y++) {
        const t = Math.min(1, y / (rows * 0.85));
        for (let x = 0; x < cols; x++) {
          const c = t * 1.05 > (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16 ? low : top;
          const i = (y * cols + x) * 4;
          sky[i] = c[0];
          sky[i + 1] = c[1];
          sky[i + 2] = c[2];
          sky[i + 3] = 255;
        }
      }
      stars = Array.from({ length: Math.round((cols * fireTop) / 260) }, () => ({
        x: Math.floor(Math.random() * cols),
        y: Math.floor(Math.random() * fireTop * 0.9),
        p: Math.random() * Math.PI * 2,
        s: 0.4 + Math.random() * 1.2,
      }));
    };

    let tick = 0;
    const step = () => {
      tick++;
      for (let x = 0; x < cols; x++) {
        const wave = Math.sin(x * 0.09 + tick * 0.035) + Math.sin(x * 0.23 - tick * 0.05) * 0.6;
        fire[(fireRows - 1) * cols + x] = wave > -0.4 ? MAX : Math.max(0, MAX - 14);
      }
      // classic upward-spreading pixel fire with a little wind
      for (let x = 0; x < cols; x++) {
        for (let y = 1; y < fireRows; y++) {
          const src = y * cols + x;
          const p = fire[src];
          if (p === 0) {
            fire[src - cols] = 0;
            continue;
          }
          const rnd = (Math.random() * 3) | 0;
          const dst = Math.min(fire.length - 1, Math.max(cols, src - rnd + 1));
          const decay = Math.random() < 0.5 ? 1 : 2;
          fire[dst - cols] = Math.max(0, p - decay);
        }
      }
      // the pointer fans the flames where it hovers
      if (pointer.x >= 0 && pointer.y >= fireTop) {
        const fy = pointer.y - fireTop;
        for (let dx = -1; dx <= 1; dx++) {
          const x = pointer.x + dx;
          if (x >= 0 && x < cols && fy >= 0 && fy < fireRows) fire[fy * cols + x] = MAX - 2;
        }
      }
    };

    const draw = (t: number) => {
      const d = img.data;
      d.set(sky);
      for (const s of stars) {
        const v = 0.5 + 0.5 * Math.sin(t * 0.001 * s.s + s.p);
        if (v < 0.35) continue;
        const i = (s.y * cols + s.x) * 4;
        const c = v > 0.92 ? 230 : v > 0.7 ? 150 : 80;
        d[i] = c;
        d[i + 1] = c;
        d[i + 2] = Math.min(255, c + 12);
      }
      for (let y = 0; y < fireRows; y++) {
        for (let x = 0; x < cols; x++) {
          const v = fire[y * cols + x];
          if (v === 0) continue;
          const a = ICE[v], b = RED[v];
          const i = ((fireTop + y) * cols + x) * 4;
          d[i] = a[0] + (b[0] - a[0]) * red;
          d[i + 1] = a[1] + (b[1] - a[1]) * red;
          d[i + 2] = a[2] + (b[2] - a[2]) * red;
        }
      }
      ctx.putImageData(img, 0, 0);
    };

    build();

    if (reduce) {
      for (let i = 0; i < fireRows * 2; i++) step();
      draw(0);
      return;
    }

    let raf = 0, last = 0, visible = true;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || t - last < 1000 / 24) return; // pixel fire looks best at a low frame rate
      last = t;
      red += (redTarget - red) * 0.18;
      step();
      draw(t);
    };
    raf = requestAnimationFrame(loop);

    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);
    const ro = new ResizeObserver(() => build());
    ro.observe(canvas);
    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = Math.floor((e.clientX - r.left) / CELL);
      pointer.y = Math.floor((e.clientY - r.top) / CELL);
    };
    const leave = () => (pointer.x = -1);
    const rug = (e: Event) => (redTarget = (e as CustomEvent).detail === "pulled" ? 1 : 0);
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    window.addEventListener("safu:rug", rug);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
      window.removeEventListener("safu:rug", rug);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={`pixelated ${className ?? ""}`} />;
}
