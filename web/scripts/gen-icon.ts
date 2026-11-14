// Writes src/app/icon.svg (favicon) from the mascot sprite: `pnpm --filter @safu/web icon`
import { writeFileSync } from "node:fs";
import { head, rects } from "../src/components/mascot/sprite";

const { cells, x, y, w, h } = head();
const size = Math.max(w, h) + 2;
const ox = x - (size - w) / 2, oy = y - (size - h) / 2;
const body = rects(cells).map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="1" fill="${r.c}"/>`).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ox} ${oy} ${size} ${size}" shape-rendering="crispEdges"><rect x="${ox}" y="${oy}" width="${size}" height="${size}" fill="#0a0a0a"/>${body}</svg>\n`;
writeFileSync(new URL("../src/app/icon.svg", import.meta.url), svg);
console.log("wrote src/app/icon.svg");
