/**
 * Runs the three backend services together for the demo, with prefixed logs:
 *   api (http://localhost:8787) · watcher · relayer
 * Watcher/relayer poll every 5s here so the demo moves at video speed.
 *
 *   pnpm --filter @safu/demo services
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const colors: Record<string, string> = { api: "\x1b[36m", watcher: "\x1b[33m", relayer: "\x1b[35m" };

const port = Number(process.env.PORT ?? 8787);
await new Promise<void>((ok) => {
  const probe = createServer()
    .once("error", () => {
      console.error(`port ${port} is already in use — a previous API is still running. Stop it first (lsof -ti :${port} | xargs kill).`);
      process.exit(1);
    })
    .once("listening", () => probe.close(() => ok()))
    .listen(port);
});

for (const name of ["api", "watcher", "relayer"]) {
  const child = spawn("pnpm", ["-s", "start"], {
    cwd: join(root, "services", name),
    env: { ...process.env, POLL_MS: process.env.POLL_MS ?? "5000", HEARTBEAT_MS: process.env.HEARTBEAT_MS ?? "60000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tag = `${colors[name]}${name.padEnd(7)}\x1b[0m │ `;
  const pipe = (buf: Buffer) => {
    for (const line of buf.toString().split("\n")) if (line.trim()) console.log(tag + line);
  };
  child.stdout.on("data", pipe);
  child.stderr.on("data", pipe);
  child.on("exit", (code) => console.log(`${tag}exited (${code})`));
  process.on("SIGINT", () => child.kill("SIGINT"));
}
