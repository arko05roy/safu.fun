/**
 * safu.fun relayer — drains the contract's payout queue.
 *
 *   pnpm --filter @safu/relayer start     # loop forever
 *   pnpm --filter @safu/relayer once      # one pass, then exit
 */
import { config } from "./config.js";
import { safu, type Payout } from "./near.js";
import { handleRailA } from "./railA.js";
import { handleRailB } from "./railB.js";
import { log } from "./log.js";

type Rail = "A" | "B";

async function chooseRail(p: Payout): Promise<Rail | null> {
  if (p.rail === "Intents") return "A";
  if (p.rail === "ChainSig" || p.evm_nonce !== null) return "B";
  const canA = config.railAEnabled && p.payout_asset.length > 0;
  const canB = (await safu.getEvmChain(p.payout_chain)) !== null && /^0x[0-9a-fA-F]{40}$/.test(p.recipient);
  if (canA && canB) return config.railPreference;
  if (canA) return "A";
  if (canB) return "B";
  return null;
}

const inFlight = new Set<number>();

async function tick() {
  const pending = await safu.listPending();
  for (const p of pending) {
    if (p.status === "Processing" || inFlight.has(p.id)) continue;
    const rail = await chooseRail(p);
    if (!rail) {
      log(p.id, `no rail can pay ${p.payout_asset} on ${p.payout_chain} (Rail A ${config.railAEnabled ? "on" : "off"}, no Rail B config)`);
      continue;
    }
    inFlight.add(p.id);
    try {
      await (rail === "A" ? handleRailA(p) : handleRailB(p));
    } catch (e) {
      log(p.id, `error on rail ${rail}: ${(e as Error).message}`);
    } finally {
      inFlight.delete(p.id);
    }
  }
  return pending.length;
}

async function main() {
  log(null, `network=${config.network} contract=${config.contract} relayer=${config.relayerAccount} railA=${config.railAEnabled} pref=${config.railPreference}`);
  const once = process.argv.includes("--once");
  for (;;) {
    try {
      const n = await tick();
      if (once) {
        log(null, `pass complete (${n} pending at start)`);
        return;
      }
    } catch (e) {
      log(null, `tick failed: ${(e as Error).message}`);
      if (once) process.exitCode = 1;
      if (once) return;
    }
    await new Promise((r) => setTimeout(r, config.pollMs));
  }
}

main();
