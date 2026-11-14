/**
 * Runs the whole backend for the demo: the Next.js app serves the API at
 * http://localhost:3000/api and runs the watcher + relayer loops in-process.
 * Watcher/relayer poll every 5s here so the demo moves at video speed.
 *
 *   pnpm --filter @safu/demo services
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = Number(process.env.PORT ?? 3000);
await new Promise<void>((ok) => {
  const probe = createServer()
    .once("error", () => {
      console.error(`port ${port} is already in use. Stop the running server first (lsof -ti :${port} | xargs kill).`);
      process.exit(1);
    })
    .once("listening", () => probe.close(() => ok()))
    .listen(port);
});

const child = spawn("pnpm", ["-s", "dev", "--port", String(port)], {
  cwd: join(root, "web"),
  env: { ...process.env, SAFU_JOBS: "on", POLL_MS: process.env.POLL_MS ?? "5000", HEARTBEAT_MS: process.env.HEARTBEAT_MS ?? "60000" },
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
