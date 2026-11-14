// Generates the README art in docs/media from the mascot sprite:
//   banner.svg  - pixel title + tagline, mascot on its rug over pixel fire (animated)
//   mascot.svg  - the mascot alone, blinking and bobbing
// Run: pnpm --filter @safu/web readme-art
import { mkdirSync, writeFileSync } from "node:fs";
import { H, rects, sprite, W } from "../src/components/mascot/sprite";

const out = new URL("../../docs/media/", import.meta.url);
mkdirSync(out, { recursive: true });

// ───────── 5×7 pixel font (only the glyphs we need) ─────────
const FONT: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  ".": ["..", "..", "..", "..", "..", "##", "##"],
  ",": ["..", "..", "..", "..", "##", "##", "#."],
  " ": ["...", "...", "...", "...", "...", "...", "..."],
};

/** Text as run-length rects at (x, y) with pixel unit u. Returns svg + width. */
function text(str: string, x: number, y: number, u: number, fill: string): { svg: string; w: number } {
  let cx = x;
  const parts: string[] = [];
  for (const ch of str) {
    const g = FONT[ch];
    if (!g) throw new Error(`no glyph for "${ch}"`);
    g.forEach((row, ry) => {
      let rx = 0;
      while (rx < row.length) {
        if (row[rx] !== "#") {
          rx++;
          continue;
        }
        let n = 1;
        while (row[rx + n] === "#") n++;
        parts.push(`<rect x="${cx + rx * u}" y="${y + ry * u}" width="${n * u}" height="${u}"/>`);
        rx += n;
      }
    });
    cx += (g[0].length + 1) * u;
  }
  return { svg: `<g fill="${fill}">${parts.join("")}</g>`, w: cx - x - u };
}

// ───────── deterministic pixel fire (same algorithm as the hero) ─────────
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
const MAX = 36;
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function ramp(stops: [number, string][]) {
  const out: string[] = [];
  for (let i = 0; i <= MAX; i++) {
    let k = 0;
    while (k < stops.length - 2 && i > stops[k + 1][0]) k++;
    const [i0, c0] = stops[k], [i1, c1] = stops[k + 1];
    const t = Math.min(1, Math.max(0, (i - i0) / (i1 - i0)));
    const a = hex(c0), b = hex(c1);
    out.push(`#${a.map((v, j) => Math.round(v + (b[j] - v) * t).toString(16).padStart(2, "0")).join("")}`);
  }
  return out;
}
const ICE = ramp([[0, "#0a0a0a"], [6, "#15181f"], [13, "#2a303c"], [20, "#4f596c"], [27, "#7f8ba3"], [32, "#b9c3d6"], [36, "#f2f2f2"]]);

function fireFrame(cols: number, rows: number, seed: number, steps: number): number[] {
  const r = rng(seed);
  const f = new Array(cols * rows).fill(0);
  for (let t = 0; t < steps; t++) {
    for (let x = 0; x < cols; x++) {
      const wave = Math.sin(x * 0.09 + t * 0.035) + Math.sin(x * 0.23 - t * 0.05) * 0.6;
      f[(rows - 1) * cols + x] = wave > -0.15 ? MAX : wave > -0.7 ? MAX - 16 : 0;
    }
    for (let x = 0; x < cols; x++)
      for (let y = 1; y < rows; y++) {
        const src = y * cols + x, p = f[src];
        if (p === 0) {
          f[src - cols] = 0;
          continue;
        }
        const k = Math.floor(r() * 3);
        const dst = Math.min(f.length - 1, Math.max(cols, src - k + 1));
        f[dst - cols] = Math.max(0, p - (r() < 0.5 ? 1 : 2));
      }
  }
  return f;
}

function fireSvg(f: number[], cols: number, rows: number, cell: number, oy: number): string {
  const parts: string[] = [];
  // drop the white-hot base rows; the flames read better as tongues
  for (let y = 0; y < rows - 3; y++) {
    let x = 0;
    while (x < cols) {
      const v = f[y * cols + x];
      let n = 1;
      while (x + n < cols && f[y * cols + x + n] === v) n++;
      if (v > 2) parts.push(`<rect x="${x * cell}" y="${oy + y * cell}" width="${n * cell}" height="${cell}" fill="${ICE[v]}"/>`);
      x += n;
    }
  }
  return parts.join("");
}

// ───────── sprite pieces ─────────
function spriteSvg(eyes: "open" | "blink", u: number) {
  return rects(sprite(eyes))
    .map((r) => `<rect x="${r.x * u}" y="${r.y * u}" width="${r.w * u}" height="${u}" fill="${r.c}"/>`)
    .join("");
}

function rugSvg(u: number, width: number) {
  const parts: string[] = [];
  for (let x = 0; x < width; x++) {
    const fringe = x === 0 || x === width - 1;
    for (let y = 0; y < 4; y++) {
      let c: string | null;
      if (fringe) c = y % 2 === 0 ? "#f2f2f2" : null;
      else {
        const stripe = x === 3 || x === width - 4 || (y === 1 && x > 5 && x < width - 6 && x % 4 === 0);
        c = stripe ? "#f2f2f2" : y === 3 ? "#b8261e" : "#ff3b30";
      }
      if (c) parts.push(`<rect x="${x * u}" y="${y * u}" width="${u}" height="${u}" fill="${c}"/>`);
    }
  }
  return parts.join("");
}

/** Mascot that blinks every few seconds and bobs one pixel. */
function mascotGroup(u: number) {
  return `<g class="bob"><g class="eyes-open">${spriteSvg("open", u)}</g><g class="eyes-blink">${spriteSvg("blink", u)}</g></g>`;
}

const STYLE = `<style>
.bob{animation:bob 1.2s steps(1) infinite}
@keyframes bob{0%,49%{transform:translateY(0)}50%,100%{transform:translateY(-1px)}}
.eyes-blink{opacity:0;animation:blink 4.2s steps(1) infinite}
.eyes-open{animation:open 4.2s steps(1) infinite}
@keyframes blink{0%,93%{opacity:0}94%,97%{opacity:1}98%,100%{opacity:0}}
@keyframes open{0%,93%{opacity:1}94%,97%{opacity:0}98%,100%{opacity:1}}
.f1{animation:f1 .5s steps(1) infinite}.f2{animation:f2 .5s steps(1) infinite}.f3{animation:f3 .5s steps(1) infinite}
@keyframes f1{0%,32%{opacity:1}33%,100%{opacity:0}}
@keyframes f2{0%,32%{opacity:0}33%,65%{opacity:1}66%,100%{opacity:0}}
@keyframes f3{0%,65%{opacity:0}66%,100%{opacity:1}}
@media (prefers-reduced-motion:reduce){.bob,.eyes-blink,.eyes-open,.f1,.f2,.f3{animation:none}.f2,.f3{opacity:0}}
</style>`;

// ───────── banner ─────────
{
  const BW = 1280, BH = 500, CELL = 10;
  const cols = BW / CELL, rows = 19;
  const fireY = BH - (rows - 3) * CELL;
  const frames = [101, 202, 303].map((s, i) => `<g class="f${i + 1}">${fireSvg(fireFrame(cols, rows, s, 160 + i * 7), cols, rows, CELL, fireY)}</g>`);

  const r = rng(7);
  const stars = Array.from({ length: 34 }, () => {
    const x = Math.floor(r() * cols) * CELL, y = Math.floor(r() * (fireY / CELL - 4)) * CELL;
    const c = r() > 0.75 ? "#b9c3d6" : "#4f596c";
    return `<rect x="${x}" y="${y}" width="${CELL / 2}" height="${CELL / 2}" fill="${c}"/>`;
  }).join("");

  const title = text("SAFU", 64, 70, 12, "#f2f2f2");
  const dotfun = text(".FUN", 64 + title.w + 12, 70, 12, "#7f8ba3");
  const l1 = text("BUY ANY MEMECOIN.", 66, 200, 5, "#b9c3d6");
  const l2a = text("IF IT RUGS, ", 66, 250, 5, "#b9c3d6");
  const l2b = text("YOU GET PAID.", 66 + l2a.w + 5, 250, 5, "#c6ff3d");

  const U = 10, RUGW = 26;
  const mx = 880, my = fireY - (H * U + 4 * U) + U * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BW} ${BH}" width="${BW}" height="${BH}" shape-rendering="crispEdges">
${STYLE}
<rect width="${BW}" height="${BH}" fill="#0a0a0a"/>
${stars}
${title.svg}${dotfun.svg}
${l1.svg}${l2a.svg}${l2b.svg}
<rect x="66" y="320" width="56" height="4" fill="#c6ff3d"/>
${frames.join("")}
<g transform="translate(${mx - ((RUGW - W) * U) / 2},${my + H * U - U})">${rugSvg(U, RUGW)}</g>
<g transform="translate(${mx},${my})">${mascotGroup(U)}</g>
</svg>`;
  writeFileSync(new URL("banner.svg", out), svg);
}

// ───────── mascot alone ─────────
{
  const U = 10, RUGW = 26;
  const w = RUGW * U, h = (H + 4) * U;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -2 ${w} ${h + 2}" width="${w}" height="${h + 2}" shape-rendering="crispEdges">
${STYLE}
<g transform="translate(0,${(H - 1) * U})">${rugSvg(U, RUGW)}</g>
<g transform="translate(${((RUGW - W) * U) / 2},0)">${mascotGroup(U)}</g>
</svg>`;
  writeFileSync(new URL("mascot.svg", out), svg);
}

console.log("wrote docs/media/banner.svg, docs/media/mascot.svg");
