/**
 * safu's mascot, drawn procedurally on a 24×23 grid: ellipse body, ears,
 * feet, collar, then an automatic outline. Every expression is a few pixel
 * edits away. Shared by the hero mascot, the logo and the favicon.
 */

export const W = 24;
export const H = 23;

export type Eyes = "open" | "blink" | "happy" | "wide";

export const COLORS: Record<string, string> = {
  o: "#15171c", // outline
  b: "#b9c3d6", // body
  s: "#8793aa", // shade
  h: "#eef1f6", // highlight
  e: "#0a0a0a", // eye / mouth
  w: "#f2f2f2", // eye shine
  r: "#ff8a80", // inner ear
  p: "#ff8a80", // cheeks
  g: "#c6ff3d", // collar
  y: "#86ad1f", // collar tag
};

const LEFT_EAR: [number, number, number][] = [
  [3, 5, 5],
  [4, 4, 6],
  [5, 4, 7],
  [6, 3, 8],
  [7, 3, 9],
  [8, 3, 9],
];
const INNER_EAR: [number, number, number][] = [
  [5, 5, 5],
  [6, 5, 6],
  [7, 5, 7],
];

export function sprite(eyes: Eyes = "open", gx = 0, gy = 0, { feet = true, collar = true } = {}): string[][] {
  const g = Array.from({ length: H }, () => Array<string>(W).fill("."));
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c;
  };
  const mirror = (x: number, y: number, c: string) => {
    set(x, y, c);
    set(W - 1 - x, y, c);
  };

  const cx = 11.5, cy = 13, rx = 9.6, ry = 7.4;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if ((x - cx) ** 2 / rx ** 2 + (y - cy) ** 2 / ry ** 2 <= 1) g[y][x] = "b";
  for (const [y, a, b] of LEFT_EAR) for (let x = a; x <= b; x++) mirror(x, y, "b");
  for (const [y, a, b] of INNER_EAR) for (let x = a; x <= b; x++) mirror(x, y, "r");
  if (feet) for (let x = 6; x <= 9; x++) for (let y = 19; y <= 21; y++) mirror(x, y, "b");

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (g[y][x] === "b" && (y >= 19 || (x - cx > rx * 0.6 && y > 9))) g[y][x] = "s";
  set(6, 9, "h");
  set(5, 10, "h");
  set(5, 11, "h");
  set(7, 8, "h");
  if (collar) {
    for (let x = 0; x < W; x++) if (g[17][x] === "b" || g[17][x] === "s") g[17][x] = "g";
    set(11, 18, "y");
    set(12, 18, "y");
  }
  mirror(5, 13, "p");
  mirror(6, 13, "p");

  const L = 7 + gx, R = 15 + gx, T = 10 + gy;
  if (eyes === "open") {
    for (const x0 of [L, R]) {
      for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 3; dy++) set(x0 + dx, T + dy, "e");
      set(x0, T, "w");
    }
  } else if (eyes === "blink") {
    for (const x0 of [L, R]) for (let dx = 0; dx < 2; dx++) set(x0 + dx, T + 1, "e");
  } else if (eyes === "happy") {
    for (const x0 of [6, 15]) {
      set(x0, 11, "e");
      set(x0 + 1, 10, "e");
      set(x0 + 2, 11, "e");
    }
  } else {
    for (const x0 of [6, 15]) {
      for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) set(x0 + dx, 9 + dy, "e");
      set(x0, 9, "w");
    }
  }
  const mouth = eyes === "wide" ? [[11, 14], [12, 14], [11, 15], [12, 15]] : [[10, 14], [11, 15], [12, 15], [13, 14]];
  for (const [x, y] of mouth) set(x, y, "e");

  const out = g.map((row) => [...row]);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (g[y][x] !== ".") continue;
      outer: for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const c = g[y + dy]?.[x + dx];
          if (c && c !== ".") {
            out[y][x] = "o";
            break outer;
          }
        }
    }
  return out;
}

/** Head only (rows 2-18, no feet), for the logo and favicon. */
export function head(): { cells: string[][]; x: number; y: number; w: number; h: number } {
  const cells = sprite("open", 0, 0, { feet: false, collar: false });
  return { cells, x: 2, y: 2, w: 20, h: 19 };
}

/** Run-length rects per row, so the SVG stays small. */
export function rects(cells: string[][]): { x: number; y: number; w: number; c: string }[] {
  const out: { x: number; y: number; w: number; c: string }[] = [];
  cells.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      let n = 1;
      while (row[x + n] === c) n++;
      if (c !== ".") out.push({ x, y, w: n, c: COLORS[c] });
      x += n;
    }
  });
  return out;
}
