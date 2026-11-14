/**
 * safu.fun — UNO REVERSE demo on NEAR testnet (PRD §5.5, demo beat 5).
 * "When the dev rugs, the liquidity rugs the dev." Everything is real:
 *
 *   1. a dev launches a coin with UNO REVERSE: locks 50% (unlocks 10% / 20s),
 *      seeds a contract-owned pool with 40% + USDC, keeps 10%
 *   2. cover on an UNO coin costs ~1%; a buyer covers, then buyers ape in
 *   3. the dev claims a tranche and dumps everything into the pool
 *   4. the watcher reports R1; on finalize the launch is UNO REVERSE'd:
 *      pool frozen, dev's locked bag + pool coin burned, holders snapshotted
 *      and refunded pro-rata in USDC; the buyer's cover pays out too
 *
 * Prereqs: same as demo.ts (services running, buyer holds testnet USDC).
 *   pnpm --filter @safu/demo uno
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, actions } from "near-api-js";
import "dotenv/config";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NET = "testnet";
const RPCS = (process.env.NEAR_RPCS ?? "https://test.rpc.fastnear.com,https://near-testnet.drpc.org").split(",");
const CONTRACT = process.env.SAFU_CONTRACT ?? "cover.safufun-d73f3d.testnet";
const API = process.env.API_URL ?? "http://localhost:8787";
const BUYER = process.env.DEMO_BUYER ?? "buyer.safudemo-81cf1a.testnet";
const WASM = join(ROOT, "target/near/demo_token/demo_token.wasm");
const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const E18 = 10n ** 18n;
const STORAGE = 1_250_000_000_000_000_000_000n;
const PERIOD_MS = 20_000;

const rawError = console.error.bind(console);
console.error = (...a: unknown[]) => {
  const e = a[0] as { cause?: unknown } | undefined;
  if (e && typeof e === "object" && e.constructor?.name === "ProviderError") return rawError(`\x1b[2m         (rpc ${String(e.cause ?? "error")} — failing over)\x1b[0m`);
  rawError(...a);
};
const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 3, wait: 500, backoff: 2 })));
const t0 = Date.now();

const c = { dim: "\x1b[2m", b: "\x1b[1m", g: "\x1b[32m", r: "\x1b[31m", m: "\x1b[35m", x: "\x1b[0m" };
const clock = () => `${c.dim}[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s]${c.x}`;
const step = (n: number, s: string) => console.log(`\n${clock()} ${c.b}${n}. ${s}${c.x}`);
const say = (s: string) => console.log(`${clock()}    ${s}`);
const txLink = (h: string) => `https://testnet.nearblocks.io/txns/${h}`;
const usdc = (x: string | bigint) => (Number(BigInt(x)) / 1e6).toFixed(4);
const tok = (x: string | bigint) => `${(Number(BigInt(x) / 10n ** 15n) / 1e3 / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;

const keyPath = (id: string) => join(homedir(), ".near-credentials", NET, `${id}.json`);
const loadKey = (id: string) => JSON.parse(readFileSync(keyPath(id), "utf8")).private_key as `ed25519:${string}`;
function saveKey(id: string, kp: KeyPair) {
  mkdirSync(dirname(keyPath(id)), { recursive: true });
  writeFileSync(keyPath(id), JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }));
}
const acct = (id: string) => new Account(id, provider, loadKey(id));

async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as T;
}
async function call(from: Account, contractId: string, methodName: string, args: Record<string, unknown>, deposit = 0n, gas = 30n) {
  const res = await from.callFunctionRaw({ contractId, methodName, args, deposit, gas: gas * TGAS, waitUntil: "FINAL" });
  return { hash: res.transaction.hash, logs: res.receipts_outcome.flatMap((r) => r.outcome.logs) };
}
const events = (logs: string[], name: string) =>
  logs.filter((l) => l.startsWith("EVENT_JSON:")).map((l) => JSON.parse(l.slice(11))).filter((e) => e.event === name).map((e) => e.data[0]);
async function api<T>(path: string, body?: object): Promise<T> {
  const r = await fetch(`${API}${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(`API ${path}: ${j.error ?? r.status}`);
  return j as T;
}
async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 300_000, everyMs = 3_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`timed out waiting for ${what}`);
}

type Launch = { id: number; status: "Active" | { Reversed: { report_id: number } }; pool_token: string; pool_usdc: string; refund_pot_usdc: string; burned_token: string; snapshot_total: string; refunds_paid_usdc: string };

async function main() {
  console.log(`${c.b}🔄 UNO REVERSE${c.x} — when the dev rugs, the liquidity rugs the dev.`);
  if (!existsSync(WASM)) throw new Error("build the demo token first: (cd contracts/demo-token && cargo near build non-reproducible-wasm)");
  await api("/health").catch(() => {
    throw new Error(`API not reachable at ${API} — run: pnpm --filter @safu/demo services`);
  });
  const cfg = await api<{ config: { usdc: string; max_token_exposure_bps: number }; pool: { available_usdc: string } }>("/config");
  const USDC = cfg.config.usdc;

  // 1. launch with UNO REVERSE
  step(1, "an honest-looking dev launches with UNO REVERSE");
  const tag = randomBytes(3).toString("hex");
  const DEV = process.env.DEMO_DEV ?? `unodev-${tag}.testnet`;
  if (!process.env.DEMO_DEV) {
    try {
      execFileSync(existsSync(join(homedir(), ".cargo/bin/near")) ? join(homedir(), ".cargo/bin/near") : "near", ["account", "create-account", "sponsor-by-faucet-service", DEV, "autogenerate-new-keypair", "save-to-legacy-keychain", "network-config", NET, "create"], { stdio: "ignore" });
    } catch {
      throw new Error("the testnet faucet refused a new account. Re-run with DEMO_DEV=<funded account with a key in ~/.near-credentials/testnet>");
    }
  }
  const dev = acct(DEV);
  const COIN = `uno-${tag}.${DEV}`;
  const FAN = `fan-${tag}.${DEV}`;
  for (const [id, tenths] of [[COIN, 22n], [FAN, 2n]] as const) {
    const kp = KeyPair.fromRandom("ed25519");
    await dev.createSubAccount({ accountOrPrefix: id, publicKey: kp.getPublicKey(), nearToTransfer: (tenths * NEAR) / 10n });
    saveKey(id, kp);
  }
  const coin = acct(COIN);
  const d = await coin.signAndSendTransaction({
    receiverId: COIN,
    actions: [
      actions.deployContract(readFileSync(WASM)),
      actions.functionCall("new", { owner_id: DEV, total_supply: (1_000_000_000n * E18).toString(), name: `Trust Me Bro ${tag}`, symbol: "TRUSTME", decimals: 18 }, 100n * TGAS, 0n),
    ],
    waitUntil: "FINAL",
  });
  say(`$TRUSTME deployed at ${COIN} (1B supply)  ${c.dim}${txLink(d.transaction.hash)}${c.x}`);

  const created = await call(dev, CONTRACT, "create_uno_launch", { token: COIN, tranche_bps: 1_000, period_ms: PERIOD_MS }, 0n, 50n);
  const LID: number = events(created.logs, "uno_launch_created")[0].id;
  say(`UNO REVERSE launch #${LID} — custody: ${CONTRACT}  ${c.dim}${txLink(created.hash)}${c.x}`);
  await call(dev, COIN, "ft_transfer_call", { receiver_id: CONTRACT, amount: (500_000_000n * E18).toString(), msg: JSON.stringify({ uno_lock: LID }) }, 1n, 100n);
  say(`dev allocation 500M locked in the contract — unlocks 10% every ${PERIOD_MS / 1000}s`);

  // the dev's launch capital (testnet: fronted by the buyer account)
  const buyer = acct(BUYER);
  for (const who of [DEV, FAN]) await call(buyer, USDC, "storage_deposit", { account_id: who, registration_only: true }, STORAGE);
  await call(buyer, USDC, "ft_transfer", { receiver_id: DEV, amount: "1000000" }, 1n);
  await call(buyer, USDC, "ft_transfer", { receiver_id: FAN, amount: "300000" }, 1n);
  await call(dev, COIN, "ft_transfer_call", { receiver_id: CONTRACT, amount: (400_000_000n * E18).toString(), msg: JSON.stringify({ uno_seed: LID }) }, 1n, 100n);
  await call(dev, USDC, "ft_transfer_call", { receiver_id: CONTRACT, amount: "1000000", msg: JSON.stringify({ uno_seed: LID }) }, 1n, 100n);
  say(`pool seeded with 400M $TRUSTME + 1 USDC — owned by the contract. ${c.m}"you can't touch this. neither can we."${c.x}`);
  say(`dev keeps 100M liquid`);

  // 2. cover + ape
  step(2, "cover on an UNO coin is cheap — then the degens ape in");
  const odds = await until("indexer", () => api<{ rug_odds_pct: number; premium_bps: number; uno: { id: number } | null }>(`/odds/near/${COIN}`), 300_000, 15_000);
  say(`rug odds ${odds.rug_odds_pct}% — but ${c.g}UNO REVERSE launch #${odds.uno?.id} → cover premium ${(odds.premium_bps / 100).toFixed(2)}%${c.x}`);
  const room = (BigInt(cfg.pool.available_usdc) * BigInt(cfg.config.max_token_exposure_bps)) / 10_000n;
  const q = await api<{ quote: { premium_usdc: string; cover_usdc: string }; pay: { receiver_id: string; method: string; args: Record<string, unknown> } }>("/cover/quote", {
    token_chain: "near", token_addr: COIN, cover_usdc: ((room * 60n) / 100n).toString(),
    payout_chain: "near", payout_asset: `nep141:${USDC}`, recipient: BUYER, payer: BUYER,
  });
  const cov = await call(buyer, q.pay.receiver_id, q.pay.method, q.pay.args, 1n, 100n);
  const bought = events(cov.logs, "cover_bought")[0];
  say(`buyer covered ${usdc(q.quote.cover_usdc)} USDC for ${usdc(q.quote.premium_usdc)} USDC premium (policy #${bought.policy_id})`);
  for (const [who, amt] of [[BUYER, 500_000n], [FAN, 300_000n]] as const) {
    const r = await call(acct(who), USDC, "ft_transfer_call", { receiver_id: CONTRACT, amount: amt.toString(), msg: JSON.stringify({ uno_buy: { id: LID, min_out: "0" } }) }, 1n, 100n);
    const b = events(r.logs, "uno_buy")[0];
    say(`${who} bought ${tok(b.token_out)} $TRUSTME for ${usdc(amt)} USDC from the pool`);
  }

  // 3. the dev rugs
  step(3, "the dev claims a tranche and dumps everything");
  await until("first tranche", async () => BigInt(await view<string>(CONTRACT, "uno_claimable", { launch_id: LID })) > 0n, 60_000, 2_000);
  await call(dev, CONTRACT, "claim_unlock", { launch_id: LID }, 0n, 50n);
  const bag = BigInt(await view<string>(COIN, "ft_balance_of", { account_id: DEV }));
  const dump = await call(dev, COIN, "ft_transfer_call", { receiver_id: CONTRACT, amount: bag.toString(), msg: JSON.stringify({ uno_sell: { id: LID, min_out: "0" } }) }, 1n, 100n);
  const sold = events(dump.logs, "uno_sell")[0];
  say(`${c.r}dev dumped ${tok(bag)} $TRUSTME into the pool for ${usdc(sold.usdc_out)} USDC${c.x}  ${c.dim}${txLink(dump.hash)}${c.x}`);

  // 4. UNO REVERSE
  step(4, "the watcher catches it — and the liquidity rugs the dev");
  const tokenState = () => view<{ open_report_id: number | null; rugged_report_id: number | null }>(CONTRACT, "get_token", { token_chain: "near", token_addr: COIN });
  const rid = await until("rug report", async () => (await tokenState()).open_report_id);
  say(`RUGGED — rule R1 · report #${rid} · dispute window…`);
  await until("finalization", async () => (await tokenState()).rugged_report_id !== null);
  const supplyBefore = 1_000_000_000n * E18;
  const l = await until("reverse", async () => {
    const x = await view<Launch>(CONTRACT, "get_uno_launch", { launch_id: LID });
    return x.status !== "Active" ? x : null;
  });
  say(`${c.r}🔄 UNO REVERSE'd${c.x} — pool frozen, ${usdc(l.refund_pot_usdc)} USDC of liquidity → refund pot`);
  const supply = await until("burn", async () => {
    const s = BigInt(await view<string>(COIN, "ft_total_supply"));
    return s < supplyBefore ? s : null;
  }, 60_000);
  say(`${c.r}🔥 ${tok(l.burned_token)} $TRUSTME burned${c.x} (dev's locked bag + pool) — supply ${tok(supplyBefore)} → ${tok(supply)}`);
  const done = await until("refunds", async () => {
    const x = await view<Launch>(CONTRACT, "get_uno_launch", { launch_id: LID });
    return x.snapshot_total !== "0" && BigInt(x.refunds_paid_usdc) > 0n ? x : null;
  });
  const snap = await view<{ account_id: string; amount: string; paid: boolean }[]>(CONTRACT, "get_uno_snapshot", { launch_id: LID });
  for (const h of snap) {
    const share = (BigInt(done.refund_pot_usdc) * BigInt(h.amount)) / BigInt(done.snapshot_total);
    say(`${c.g}refund → ${h.account_id}: ${usdc(share)} USDC${c.x} (held ${tok(h.amount)})`);
  }
  const payout = await until("cover payout", async () => {
    const r = await view<{ payout_ids: number[] }>(CONTRACT, "get_report", { report_id: rid });
    const p = await view<{ status: string; amount_usdc: string }>(CONTRACT, "get_payout", { payout_id: r.payout_ids[0] });
    return p.status === "Paid" ? p : null;
  });
  say(`${c.g}+ cover payout: ${usdc(payout.amount_usdc)} USDC to ${BUYER}${c.x}`);
  console.log(`\n${clock()} ${c.b}UNO REVERSE'd.${c.x} the dev's bag is ash, the holders got the liquidity back.`);
}

main().catch((e) => {
  console.error(`\n${c.r}uno demo failed:${c.x} ${(e as Error).message}`);
  process.exit(1);
});
