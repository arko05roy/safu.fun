/**
 * safu.fun API, served by Next.js at /api/* (see src/app/api/[[...route]]/route.ts).
 *
 *   GET  /health
 *   GET  /config                     contract config + pool stats + watcher heartbeat
 *   GET  /tokens                     assets 1Click can route (pay-with / get-paid-in)
 *   GET  /token/:chain/:addr         profile, rug odds, on-chain cover state
 *   GET  /odds/:chain/:addr          rug odds + premium only
 *   POST /cover/quote                cover-only: signed quote + exact ft_transfer_call to pay it
 *   POST /buy/quote                  Intents buy (mainnet, listed tokens); dry:false starts it
 *   GET  /buy/:depositAddress        Intents buy settlement status
 *   GET  /policy/:id  /payout/:id  /report/:id
 *   GET  /wall                       Wall of Rugs (all rug reports)
 *   GET  /staking                    $SAFU pot, premium share, burns, token supply
 *   GET  /stake/:account             one underwriter's stake + claimable USDC
 *   GET  /uno                        all UNO REVERSE launches
 *   GET  /uno/:id                    one launch + its refund snapshot
 */
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { config } from "./config";
import { HttpError, coverQuote, tokenView } from "./cover";
import { buyQuote, buyStatus, oneClickTokens } from "./buys";
import { safu } from "./near";
import { IndexerLagError } from "./explorers";

const log = (m: string) => console.log(`${new Date().toISOString()} [api] ${m}`);

// BigInt-safe JSON
const json = (v: unknown) =>
  new Response(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)), {
    headers: { "content-type": "application/json" },
  });

/**
 * Short-lived cache for the hot, page-wide reads (config, staking, wall, uno).
 * Every visitor polls these, and they share the free NEAR RPC with the watcher
 * and relayer, so we answer from memory for a few seconds and keep serving the
 * last good value if the RPC rate-limits us.
 */
const cache = new Map<string, { at: number; value: unknown; inflight?: Promise<unknown> }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  if (hit?.inflight) return hit.inflight as Promise<T>;
  const attempt = async (): Promise<T> => {
    // the free NEAR RPC answers 429 under bursts; back off briefly before giving up
    for (let i = 0; ; i++) {
      try {
        return await load();
      } catch (e) {
        if (i >= 2) throw e;
        await new Promise((r) => setTimeout(r, 400 * (i + 1) ** 2));
      }
    }
  };
  const inflight = attempt().then(
    (value) => {
      cache.set(key, { at: Date.now(), value });
      return value;
    },
    (e) => {
      if (hit) {
        cache.set(key, { at: hit.at, value: hit.value });
        return hit.value as T;
      }
      cache.delete(key);
      throw e;
    },
  );
  cache.set(key, { at: hit?.at ?? 0, value: hit?.value, inflight });
  return inflight;
}

export const app = new Hono().basePath("/api");
app.use("*", cors());

app.onError((e, c) => {
  if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
  if (e instanceof IndexerLagError) return c.json({ error: e.message, retry: true }, 503);
  log(`error ${c.req.method} ${c.req.path}: ${e.message}`);
  return c.json({ error: e.message }, 500);
});

app.get("/health", () => json({ ok: true, network: config.network, contract: config.contract }));

app.get("/config", async () =>
  json(
    await cached("config", 8_000, async () => {
      const [cfg, pool, heartbeat] = await Promise.all([safu.getConfig(), safu.poolStats(), safu.lastHeartbeatMs()]);
      return { network: config.network, contract: config.contract, config: cfg, pool, watcher_heartbeat_ms: heartbeat };
    }),
  ),
);

app.get("/tokens", async () => json(await oneClickTokens()));

app.get("/token/:chain/:addr", async (c) => json(await tokenView(c.req.param("chain"), c.req.param("addr"))));

app.get("/odds/:chain/:addr", async (c) => {
  const v = await tokenView(c.req.param("chain"), c.req.param("addr"));
  return json({ rug_odds_pct: v.risk.rugOddsPct, premium_bps: v.risk.premiumBps, factors: v.risk.factors, uno: v.uno });
});

app.post("/cover/quote", async (c) => json(await coverQuote(await c.req.json())));

app.post("/buy/quote", async (c) => json(await buyQuote(await c.req.json())));

app.get("/buy/:deposit", (c) => {
  const b = buyStatus(c.req.param("deposit"));
  return b ? json(b) : c.json({ error: "unknown deposit address" }, 404);
});

const byId = (fn: (id: number) => Promise<unknown>) => async (c: Context) => {
  const v = await fn(Number(c.req.param("id")));
  return v ? json(v) : c.json({ error: "not found" }, 404);
};
app.get("/policy/:id", byId(safu.getPolicy));
app.get("/payout/:id", byId(safu.getPayout));
app.get("/report/:id", byId(safu.getReport));

app.get("/staking", async () =>
  json(
    await cached("staking", 10_000, async () => {
      const st = await safu.stakingStats();
      const supply = st.safu_token ? await safu.ftTotalSupply(st.safu_token) : null;
      return { ...st, safu_total_supply: supply };
    }),
  ),
);

app.get("/stake/:account", async (c) => {
  const v = await safu.getStake(c.req.param("account"));
  return v ? json(v) : c.json({ error: "not a staker" }, 404);
});

app.get("/uno", async () =>
  json(
    await cached("uno", 10_000, async () => {
      const n = await safu.unoCount();
      return Promise.all(Array.from({ length: n }, (_, i) => safu.unoLaunch(i)));
    }),
  ),
);

app.get("/uno/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const launch = await safu.unoLaunch(id);
  if (!launch) return c.json({ error: "not found" }, 404);
  return json({ launch, snapshot: await safu.unoSnapshot(id) });
});

app.get("/wall", async () =>
  json(
    await cached("wall", 15_000, async () => {
      const { reports } = await safu.poolStats();
      const all = await Promise.all(Array.from({ length: reports }, (_, i) => safu.getReport(i)));
      return all.filter((r) => (r as { status?: string } | null)?.status === "Finalized").reverse();
    }),
  ),
);

// Background jobs as HTTP endpoints, for hosts without long-lived processes
// (e.g. Vercel Cron). Protected by CRON_SECRET; on an always-on host the same
// jobs run in-process from src/instrumentation.ts instead.
app.get("/cron/:job", async (c) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || c.req.header("authorization") !== `Bearer ${secret}`) return c.json({ error: "unauthorized" }, 401);
  const { runJob } = await import("../jobs");
  const job = c.req.param("job");
  if (job !== "watcher" && job !== "relayer" && job !== "buys") return c.json({ error: "unknown job" }, 404);
  return json(await runJob(job));
});
