/**
 * Starts the watcher, relayer and Intents-buy settlement loops inside the
 * Next.js server process on an always-on host. Set SAFU_JOBS=off when a
 * scheduler calls /api/cron/:job instead (serverless hosts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.SAFU_JOBS === "off") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const g = globalThis as { __safuJobs?: boolean };
  if (g.__safuJobs) return; // dev server reloads must not start a second set
  g.__safuJobs = true;
  const { startJobs } = await import("./server/jobs");
  const poll = Number(process.env.POLL_MS ?? 15000);
  startJobs([
    { job: "watcher", everyMs: poll },
    { job: "relayer", everyMs: poll },
    { job: "buys", everyMs: 20_000 },
  ]);
}
