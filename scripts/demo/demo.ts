/**
 * safu.fun — end-to-end demo on NEAR testnet (PRD §8). Everything is real:
 *
 *   1. a fresh dev wallet (faucet) launches a NEP-141 memecoin, seeds an insider
 *   2. the API prices the coin's rug odds and snapshots the dev/insiders on-chain
 *   3. a buyer buys cover twice with USDC: one payout on NEAR, one on Base Sepolia
 *   4. the dev dumps
 *   5. the watcher reports R1 with the dump tx hashes; after the dispute window
 *      it finalizes and the payouts are queued
 *   6. the relayer pays the NEAR leg (USDC lands in the buyer's wallet) and gets
 *      the Base Sepolia leg signed by NEAR Chain Signatures (MPC)
 *
 * Prereqs: contracts built (`cargo near build` in contracts/demo-token), services
 * running (`pnpm --filter @safu/demo services`), buyer account holding testnet USDC.
 *
 *   pnpm --filter @safu/demo demo
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
const EVM_RECIPIENT = process.env.DEMO_RECIPIENT_ADDRESS; // Base Sepolia leg (optional)
const WASM = join(ROOT, "target/near/demo_token/demo_token.wasm");
const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;

// near-api-js logs every retried RPC error with a stack trace; failover handles
// them, so show a one-line note instead (anything else still prints in full).
const rawError = console.error.bind(console);
console.error = (...a: unknown[]) => {
  const e = a[0] as { cause?: unknown } | undefined;
  if (e && typeof e === "object" && e.constructor?.name === "ProviderError") {
    rawError(`\x1b[2m         (rpc ${String(e.cause ?? "error")} — failing over)\x1b[0m`);
    return;
  }
  rawError(...a);
};
const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 3, wait: 500, backoff: 2 })));
const t0 = Date.now();

// ───────────── output ─────────────
const c = { dim: "\x1b[2m", b: "\x1b[1m", g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", x: "\x1b[0m" };
const clock = () => `${c.dim}[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s]${c.x}`;
const step = (n: number, s: string) => console.log(`\n${clock()} ${c.b}${n}. ${s}${c.x}`);
const say = (s: string) => console.log(`${clock()}    ${s}`);
const txLink = (h: string) => `https://testnet.nearblocks.io/txns/${h}`;
const usdc = (base: string | bigint) => (Number(BigInt(base)) / 1e6).toFixed(4);

// ───────────── keys (near-cli legacy keychain, so the CLI can reuse them) ─────────────
const keyPath = (id: string) => join(homedir(), ".near-credentials", NET, `${id}.json`);
function loadKey(id: string): `ed25519:${string}` {
  if (!existsSync(keyPath(id))) throw new Error(`no key for ${id} at ${keyPath(id)}`);
  return JSON.parse(readFileSync(keyPath(id), "utf8")).private_key;
}
function saveKey(id: string, kp: KeyPair) {
  mkdirSync(dirname(keyPath(id)), { recursive: true });
  writeFileSync(keyPath(id), JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }));
}
const acct = (id: string) => new Account(id, provider, loadKey(id));

function nearCli(): string {
  const local = join(homedir(), ".cargo/bin/near");
  return existsSync(local) ? local : "near";
}

// ───────────── chain helpers ─────────────
async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as T;
}
const safuView = <T>(m: string, a: Record<string, unknown> = {}) => view<T>(CONTRACT, m, a);

async function call(from: Account, contractId: string, methodName: string, args: Record<string, unknown>, deposit = 0n, gas = 30n) {
  // wait for finality so the API's snapshot (read at the final block) sees it
  const res = await from.callFunctionRaw({ contractId, methodName, args, deposit, gas: gas * TGAS, waitUntil: "FINAL" });
  const logs = res.receipts_outcome.flatMap((r) => r.outcome.logs);
  return { hash: res.transaction.hash, logs };
}
const events = (logs: string[], name: string) =>
  logs.filter((l) => l.startsWith("EVENT_JSON:")).map((l) => JSON.parse(l.slice(11))).filter((e) => e.event === name).map((e) => e.data[0]);

async function api<T>(path: string, body?: object): Promise<T> {
  const r = await fetch(`${API}${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(`API ${path}: ${j.error ?? r.status}`);
  return j as T;
}

async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 240_000, everyMs = 3_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// ───────────── demo ─────────────
async function main() {
  console.log(`${c.b}safu.fun${c.x} — everyone's been rugged. what if the rug paid you back?`);
  console.log(`${c.dim}contract ${CONTRACT} · api ${API} · buyer ${BUYER}${c.x}`);
  if (!existsSync(WASM)) throw new Error(`build the demo token first: (cd contracts/demo-token && cargo near build non-reproducible-wasm)`);
  await api("/health").catch(() => {
    throw new Error(`API not reachable at ${API} — run: pnpm --filter @safu/demo services`);
  });

  // 1. a dev launches a coin
  step(1, "a fresh dev launches a memecoin");
  const tag = randomBytes(3).toString("hex");
  const DEV = process.env.DEMO_DEV ?? `rugdev-${tag}.testnet`;
  if (process.env.DEMO_DEV) say(`dev wallet ${DEV} (reused)`);
  else {
    try {
      execFileSync(nearCli(), ["account", "create-account", "sponsor-by-faucet-service", DEV, "autogenerate-new-keypair", "save-to-legacy-keychain", "network-config", NET, "create"], { stdio: "ignore" });
    } catch {
      throw new Error("the testnet faucet refused a new account (it rate-limits). Re-run with DEMO_DEV=<an existing funded account whose key is in ~/.near-credentials/testnet>");
    }
    say(`dev wallet ${DEV} (faucet-funded)`);
  }
  const dev = acct(DEV);
  // per-run names so a reused DEMO_DEV can launch again
  const COIN = `coin-${tag}.${DEV}`;
  const INSIDER = `insider-${tag}.${DEV}`;
  const SINK = `dex-${tag}.${DEV}`;
  for (const [id, near] of [[COIN, 22n], [INSIDER, 1n], [SINK, 1n]] as const) {
    const kp = KeyPair.fromRandom("ed25519");
    await dev.createSubAccount({ accountOrPrefix: id, publicKey: kp.getPublicKey(), nearToTransfer: (near * NEAR) / 10n });
    saveKey(id, kp);
  }
  const symbol = ["MOONRUG", "SAFEMOON3", "PEPERUG", "DEVDUMP", "GIGAJEET"][parseInt(tag, 16) % 5];
  const coin = acct(COIN);
  // deploy + init in one atomic tx, like a real launch
  const d = await coin.signAndSendTransaction({
    receiverId: COIN,
    actions: [
      actions.deployContract(readFileSync(WASM)),
      actions.functionCall("new", { owner_id: DEV, total_supply: (10n ** 27n).toString(), name: `${symbol} ${tag}`, symbol, decimals: 18 }, 100n * TGAS, 0n),
    ],
  });
  say(`$${symbol} deployed at ${COIN} — 1B supply minted to the dev  ${c.dim}${txLink(d.transaction.hash)}${c.x}`);
  for (const id of [INSIDER, SINK]) await call(dev, COIN, "storage_deposit", { account_id: id, registration_only: true }, 1_250_000_000_000_000_000_000n);
  await call(dev, COIN, "ft_transfer", { receiver_id: INSIDER, amount: (2n * 10n ** 26n).toString() }, 1n);
  say(`dev keeps 80%, insider wallet gets 20%`);

  // 2. rug odds
  step(2, "safu prices the rug odds");
  say(`${c.dim}waiting for the explorer to index the new coin…${c.x}`);
  const odds = await until("indexer", () => api<{ rug_odds_pct: number; premium_bps: number; factors: { name: string; detail: string }[] }>(`/odds/near/${COIN}`), 300_000, 15_000);
  say(`${c.r}RUG ODDS ${odds.rug_odds_pct}%${c.x} → cover premium ${(odds.premium_bps / 100).toFixed(2)}%`);
  for (const f of odds.factors) say(`${c.dim}· ${f.detail}${c.x}`);

  // 3. buyer buys cover
  step(3, "a degen buys cover — get paid on NEAR, and on Base Sepolia");
  const cfg = await api<{ config: { usdc: string; max_token_exposure_bps: number }; pool: { available_usdc: string } }>("/config");
  const room = (BigInt(cfg.pool.available_usdc) * BigInt(cfg.config.max_token_exposure_bps)) / 10_000n;
  const legs = [
    { label: "NEAR", payout_chain: "near", payout_asset: `nep141:${cfg.config.usdc}`, recipient: BUYER, cover: (room * 55n) / 100n },
    ...(EVM_RECIPIENT
      ? [{ label: "Base Sepolia", payout_chain: "base-sepolia", payout_asset: "nep141:base-0x036cbd53842c5426634e7929541ec2318f3dcf7e.omft.near", recipient: EVM_RECIPIENT, cover: (room * 35n) / 100n }]
      : []),
  ];
  type Stk = { total_staked_safu: string; total_burned_safu: string; rewards_reserved_usdc: string; rewards_paid_usdc: string; staker_share_bps: number; safu_token: string | null };
  const stk0 = await safuView<Stk>("staking_stats");
  const safu = (x: string | bigint) => `${(Number(BigInt(x) / 10n ** 15n) / 1e3).toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
  if (BigInt(stk0.total_staked_safu) > 0n) say(`${c.dim}underwriters have ${safu(stk0.total_staked_safu)} $SAFU staked behind the pool · they earn ${stk0.staker_share_bps / 100}% of premiums${c.x}`);
  const buyer = acct(BUYER);
  const balBefore = await view<string>(cfg.config.usdc, "ft_balance_of", { account_id: BUYER });
  for (const leg of legs) {
    const q = await api<{ quote: { premium_usdc: string }; pay: { receiver_id: string; method: string; args: Record<string, unknown> } }>("/cover/quote", {
      token_chain: "near", token_addr: COIN, cover_usdc: leg.cover.toString(),
      payout_chain: leg.payout_chain, payout_asset: leg.payout_asset, recipient: leg.recipient, payer: BUYER,
    });
    const r = await call(buyer, q.pay.receiver_id, q.pay.method, q.pay.args, 1n, 100n);
    const bought = events(r.logs, "cover_bought")[0];
    if (!bought) throw new Error(`cover purchase was refunded: ${txLink(r.hash)}`);
    say(`policy #${bought.policy_id}: ${usdc(leg.cover)} USDC cover → paid on ${leg.label} to ${leg.recipient} · premium ${usdc(q.quote.premium_usdc)} USDC  ${c.dim}${txLink(r.hash)}${c.x}`);
  }
  say(`${c.g}funds are safu.${c.x} watcher is now watching the dev + insider`);

  // 4. the rug
  await new Promise((r) => setTimeout(r, 8_000));
  step(4, "the dev dumps");
  await call(dev, COIN, "ft_transfer", { receiver_id: SINK, amount: (35n * 10n ** 25n).toString(), memo: "sell" }, 1n);
  const dump = await call(dev, COIN, "ft_transfer", { receiver_id: SINK, amount: (25n * 10n ** 25n).toString(), memo: "sell" }, 1n);
  say(`${c.r}dev dumped 600M of 800M (75%)${c.x}  ${c.dim}${txLink(dump.hash)}${c.x}`);

  // 5. watcher reports, window, finalize
  step(5, "the watcher catches it");
  const reportId = await until("rug report", async () => (await safuView<{ open_report_id: number | null; rugged_report_id: number | null }>("get_token", { token_chain: "near", token_addr: COIN })).open_report_id);
  const report = await safuView<{ rule: string; evidence: string[]; dispute_deadline_ms: number }>("get_report", { report_id: reportId });
  say(`${c.r}RUGGED — rule ${report.rule}${c.x} (deployer moved out ≥50%) · report #${reportId}`);
  for (const e of report.evidence) say(`${c.dim}evidence: ${e}${c.x}`);
  say(`dispute window open for ${Math.ceil((report.dispute_deadline_ms - Date.now()) / 1000)}s…`);
  await until("finalization", async () => (await safuView<{ rugged_report_id: number | null }>("get_token", { token_chain: "near", token_addr: COIN })).rugged_report_id !== null, 300_000);
  const fin = await safuView<{ payout_ids: number[] }>("get_report", { report_id: reportId });
  say(`finalized → ${fin.payout_ids.length} payouts queued (cover × 80%)`);

  // 6. payouts
  step(6, "the rug pays you back");
  for (const id of fin.payout_ids) {
    const p = await until(`payout #${id}`, async () => {
      const x = await safuView<{ status: string; payout_chain: string; amount_usdc: string; evm_tx_hash: string | null; recipient: string }>("get_payout", { payout_id: id });
      return x.status === "Paid" || x.status === "Signed" ? x : null;
    });
    if (p.status === "Paid") say(`${c.g}🔄 $${usdc(p.amount_usdc)} SENT on NEAR → ${p.recipient}${c.x}`);
    else say(`${c.g}🔄 $${usdc(p.amount_usdc)} payout on ${p.payout_chain} signed by NEAR Chain Signatures (MPC)${c.x} → ${p.recipient}  ${c.dim}tx ${p.evm_tx_hash} (ready to broadcast)${c.x}`);
  }
  const balAfter = await view<string>(cfg.config.usdc, "ft_balance_of", { account_id: BUYER });
  say(`buyer USDC on NEAR: ${usdc(balBefore)} → ${usdc(balAfter)} (premiums paid, payout received)`);
  const stk1 = await safuView<Stk>("staking_stats");
  const burned = BigInt(stk1.total_burned_safu) - BigInt(stk0.total_burned_safu);
  const earned = BigInt(stk1.rewards_reserved_usdc) + BigInt(stk1.rewards_paid_usdc) - BigInt(stk0.rewards_reserved_usdc) - BigInt(stk0.rewards_paid_usdc);
  if (burned > 0n || earned > 0n) {
    const supply = stk1.safu_token ? await view<string>(stk1.safu_token, "ft_total_supply") : null;
    say(`${c.r}🔥 stakers ate the rug: ${safu(burned)} $SAFU burned${c.x}${supply ? ` (supply now ${safu(supply)})` : ""} · they earned ${usdc(earned)} USDC in premiums`);
  }

  console.log(`\n${clock()} ${c.b}the rug got rugged.${c.x} safu.fun — buy anything, anywhere. if it rugs, you get paid.`);
  console.log(`${c.dim}built on NEAR Chain Signatures + Intents · dev ${DEV} · coin ${COIN} · report #${reportId}${c.x}`);
}

main().catch((e) => {
  console.error(`\n${c.r}demo failed:${c.x} ${(e as Error).message}`);
  process.exit(1);
});
