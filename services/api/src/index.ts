/**
 * safu.fun API.
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
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config.js";
import { HttpError, coverQuote, tokenView } from "./cover.js";
import { buyQuote, buyStatus, oneClickTokens, settleBuys } from "./buys.js";
import { safu } from "./near.js";

const log = (m: string) => console.log(`${new Date().toISOString()} [api] ${m}`);

// BigInt-safe JSON
const json = (v: unknown) =>
  new Response(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)), {
    headers: { "content-type": "application/json" },
  });

const app = new Hono();
app.use("*", cors());

app.onError((e, c) => {
  if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
  log(`error ${c.req.method} ${c.req.path}: ${e.message}`);
  return c.json({ error: e.message }, 500);
});

app.get("/health", () => json({ ok: true, network: config.network, contract: config.contract }));

app.get("/config", async () => {
  const [cfg, pool, heartbeat] = await Promise.all([safu.getConfig(), safu.poolStats(), safu.lastHeartbeatMs()]);
  return json({ network: config.network, contract: config.contract, config: cfg, pool, watcher_heartbeat_ms: heartbeat });
});

app.get("/tokens", async () => json(await oneClickTokens()));

app.get("/token/:chain/:addr", async (c) => json(await tokenView(c.req.param("chain"), c.req.param("addr"))));

app.get("/odds/:chain/:addr", async (c) => {
  const v = await tokenView(c.req.param("chain"), c.req.param("addr"));
  return json({ rug_odds_pct: v.risk.rugOddsPct, premium_bps: v.risk.premiumBps, factors: v.risk.factors });
});

app.post("/cover/quote", async (c) => json(await coverQuote(await c.req.json())));

app.post("/buy/quote", async (c) => json(await buyQuote(await c.req.json())));

app.get("/buy/:deposit", (c) => {
  const b = buyStatus(c.req.param("deposit"));
  return b ? json(b) : c.json({ error: "unknown deposit address" }, 404);
});

const byId = (fn: (id: number) => Promise<unknown>) => async (c: any) => {
  const v = await fn(Number(c.req.param("id")));
  return v ? json(v) : c.json({ error: "not found" }, 404);
};
app.get("/policy/:id", byId(safu.getPolicy));
app.get("/payout/:id", byId(safu.getPayout));
app.get("/report/:id", byId(safu.getReport));

app.get("/wall", async () => {
  const { reports } = await safu.poolStats();
  const all = await Promise.all(Array.from({ length: reports }, (_, i) => safu.getReport(i)));
  return json(all.filter((r: any) => r?.status === "Finalized").reverse());
});

serve({ fetch: app.fetch, port: config.port }, () => log(`listening on :${config.port} (${config.network}, ${config.contract})`));

setInterval(() => settleBuys(log).catch((e) => log(`settleBuys: ${e.message}`)), 20_000);
