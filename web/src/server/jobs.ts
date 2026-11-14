/**
 * The backend's background work, runnable two ways:
 *  - in-process loops (`startJobs`), started by src/instrumentation.ts when
 *    Next.js runs on an always-on host (`next start` / `next dev`);
 *  - one pass per HTTP call (`runJob`), via GET /api/cron/:job, for serverless
 *    hosts that trigger work on a schedule.
 */
export type Job = "watcher" | "relayer" | "buys";

const log = (tag: string, m: string) => console.log(`${new Date().toISOString()} [${tag}] ${m}`);

export async function runJob(job: Job): Promise<Record<string, unknown>> {
  const started = Date.now();
  if (job === "watcher") {
    const { watcherPass } = await import("./watcher");
    return { job, ...(await watcherPass()), ms: Date.now() - started };
  }
  if (job === "relayer") {
    const { relayerPass } = await import("./relayer");
    return { job, ...(await relayerPass()), ms: Date.now() - started };
  }
  const { settleBuys } = await import("./api/buys");
  await settleBuys((m) => log("buys", m));
  return { job, ms: Date.now() - started };
}

/** Run each job forever, one pass at a time, never overlapping itself. */
export function startJobs(jobs: { job: Job; everyMs: number }[]) {
  for (const { job, everyMs } of jobs) {
    const loop = async () => {
      try {
        await runJob(job);
      } catch (e) {
        log(job, `pass failed: ${(e as Error).message}`);
      }
      setTimeout(loop, everyMs);
    };
    setTimeout(loop, 1500);
    log(job, `running in-process every ${everyMs / 1000}s`);
  }
}
