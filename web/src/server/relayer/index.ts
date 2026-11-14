/**
 * safu.fun relayer — drains the contract's payout queue.
 *
 * Runs inside the Next.js server: see src/server/jobs.ts.
 */
import { config } from "./config";
import { safu, type Payout } from "./near";
import { handleRailA } from "./railA";
import { handleRailB } from "./railB";
import { log } from "./log";

type Rail = "A" | "B" | "N";

let poolUsdc: string | undefined;
async function chooseRail(p: Payout): Promise<Rail | null> {
  poolUsdc ??= `nep141:${(await safu.getConfig()).usdc}`;
  if (p.rail === "Near" || (p.rail === null && p.evm_nonce === null && p.payout_chain === "near" && p.payout_asset === poolUsdc)) return "N";
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
      if (rail === "N") {
        if (p.status === "Queued") {
          const tx = await safu.requestPayoutNear(p.id);
          const after = await safu.getPayout(p.id);
          log(p.id, after?.status === "Paid" ? `PAID on NEAR to ${p.recipient} (tx ${tx})` : `NEAR transfer failed, re-queued (tx ${tx})`);
        }
      } else await (rail === "A" ? handleRailA(p) : handleRailB(p));
    } catch (e) {
      log(p.id, `error on rail ${rail}: ${(e as Error).message}`);
    } finally {
      inFlight.delete(p.id);
    }
  }
  return pending.length;
}

/** One relayer pass over the payout queue. */
export async function relayerPass(): Promise<{ pending: number }> {
  return { pending: await tick() };
}

export const relayerPollMs = config.pollMs;
