/**
 * safu.fun rug watcher.
 *
 * Every tick, for each token with live cover (contract `list_watched`):
 *  - open report  -> once its dispute window closes, `finalize_rug` (queues payouts)
 *  - otherwise    -> read deployer + insider balances on the token's chain,
 *                    evaluate R1/R2 against the on-chain baselines, and on a hit
 *                    `report_rug` with the outgoing transfer tx hashes as evidence.
 * Stateless: everything is re-derived from the contract and the token's chain.
 *
 *   pnpm --filter @safu/watcher start   # loop
 *   pnpm --filter @safu/watcher once    # one pass
 */
import { config } from "./config.js";
import { safu, type WatchedToken } from "./near.js";
import { evaluate, type HolderState } from "./rules.js";
import { NearAdapter } from "./adapters/near.js";
import { EvmAdapter } from "./adapters/evm.js";
import type { ChainAdapter } from "./adapters/types.js";

function log(tag: string, msg: string) {
  console.log(`${new Date().toISOString()} [${tag}] ${msg}`);
}

const adapters = new Map<string, ChainAdapter>();
function adapterFor(chain: string): ChainAdapter | null {
  if (adapters.has(chain)) return adapters.get(chain)!;
  let a: ChainAdapter | null = null;
  if (chain === "near") a = new NearAdapter();
  else {
    const rpc = config.evmRpc(chain);
    if (rpc) a = new EvmAdapter(chain, rpc);
  }
  if (a) adapters.set(chain, a);
  return a;
}

async function finalizeIfDue(t: WatchedToken) {
  const r = await safu.getReport(t.open_report_id!);
  if (!r) return;
  if (r.status !== "Pending") {
    log(t.watch.token_key, `report #${r.id} is ${r.status}; waiting on owner`);
    return;
  }
  const left = r.dispute_deadline_ms - Date.now();
  if (left > 0) {
    log(t.watch.token_key, `report #${r.id} in dispute window (${Math.ceil(left / 1000)}s left)`);
    return;
  }
  const payouts = await safu.finalizeRug(r.id);
  log(t.watch.token_key, `FINALIZED report #${r.id} -> ${payouts?.length ?? 0} payouts queued`);
}

async function check(t: WatchedToken) {
  const w = t.watch;
  const chain = adapterFor(w.token_chain);
  if (!chain) {
    log(w.token_key, `no adapter for chain "${w.token_chain}" — set EVM_RPC_${w.token_chain.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`);
    return;
  }
  const read = async (h: { address: string; baseline: string }): Promise<HolderState> => ({
    address: h.address,
    baseline: BigInt(h.baseline),
    current: await chain.balanceOf(w.token_addr, h.address),
  });
  const [deployer, ...insiders] = await Promise.all([read(w.deployer), ...w.insiders.map(read)]);
  const hit = evaluate(deployer, insiders, config.r1ThresholdBps, config.r2ThresholdBps);
  if (!hit) {
    const pct = deployer.baseline > 0n ? Number(((deployer.baseline - (deployer.current < deployer.baseline ? deployer.current : deployer.baseline)) * 10_000n) / deployer.baseline) / 100 : 0;
    log(w.token_key, `ok — deployer out ${pct}% of baseline, ${t.active_policies} policies, exposure ${t.exposure_usdc}`);
    return;
  }

  // Evidence: the outgoing transfer txs, plus the balance readings themselves.
  const head = await chain.head();
  const evidence: string[] = [];
  for (const s of hit.sellers) {
    const need = s.baseline - s.current;
    const txs = await chain
      .outflows(w.token_addr, s.address, { block: BigInt(w.snapshot_block), ms: w.registered_at_ms }, need)
      .catch((e) => {
        log(w.token_key, `evidence lookup failed for ${s.address}: ${(e as Error).message}`);
        return [];
      });
    for (const tx of txs.slice(0, 10)) evidence.push(`${chain.label}:tx:${tx.txHash}`);
    evidence.push(`${chain.label}:balance:${s.address}:${s.baseline}->${s.current}@${head}`);
  }
  log(w.token_key, `RUG ${hit.rule}: ${hit.outflow}/${hit.baseline} moved out — reporting with ${evidence.length} evidence items`);
  const reportId = await safu.reportRug(w.token_chain, w.token_addr, hit.rule, evidence);
  log(w.token_key, `reported as #${reportId}`);
}

async function tick() {
  const tokens = await safu.listWatched();
  for (const t of tokens) {
    try {
      if (t.open_report_id !== null) await finalizeIfDue(t);
      else await check(t);
    } catch (e) {
      log(t.watch.token_key, `error: ${(e as Error).message}`);
    }
  }
  return tokens.length;
}

let lastBeat = 0;
async function beat() {
  if (Date.now() - lastBeat < config.heartbeatMs) return;
  await safu.heartbeat().then(
    () => (lastBeat = Date.now()),
    (e) => log("watcher", `heartbeat failed: ${(e as Error).message}`),
  );
}

async function main() {
  log("watcher", `network=${config.network} contract=${config.contract} watcher=${config.watcherAccount}`);
  const once = process.argv.includes("--once");
  for (;;) {
    try {
      await beat();
      const n = await tick();
      if (once) {
        log("watcher", `pass complete (${n} watched tokens)`);
        return;
      }
    } catch (e) {
      log("watcher", `tick failed: ${(e as Error).message}`);
      if (once) {
        process.exitCode = 1;
        return;
      }
    }
    await new Promise((r) => setTimeout(r, config.pollMs));
  }
}

main();
