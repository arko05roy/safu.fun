/**
 * Rail B — Chain Signatures payouts on EVM chains.
 *
 * The relayer is deliberately powerless here: the contract builds the tx
 * (recipient, USDC token, amount, chain id, nonce) and ecrecover-checks the MPC
 * signature. The relayer only picks gas prices (capped on-chain), broadcasts
 * the stored raw tx, and reports the receipt via `mark_paid` — which the
 * contract only accepts for the exact tx hash it signed.
 */
import { createPublicClient, http, type PublicClient, formatEther } from "viem";
import { config } from "./config.js";
import { safu, type EvmChain, type Payout } from "./near.js";
import { log } from "./log.js";

const clients = new Map<string, PublicClient>();
function client(chain: string): PublicClient {
  let c = clients.get(chain);
  if (!c) {
    const url = config.evmRpc(chain);
    if (!url) throw new Error(`no RPC for EVM chain "${chain}" (set EVM_RPC_${chain.toUpperCase().replace(/[^A-Z0-9]/g, "_")})`);
    c = createPublicClient({ transport: http(url) });
    clients.set(chain, c);
  }
  return c;
}

/** 2×baseFee + tip, clamped to the contract's cap. */
async function fees(chain: string, cfg: EvmChain) {
  const c = client(chain);
  const block = await c.getBlock({ blockTag: "latest" });
  const tip = await c.estimateMaxPriorityFeePerGas().catch(() => 1_000_000n);
  const base = block.baseFeePerGas ?? (await c.getGasPrice());
  const cap = BigInt(cfg.max_fee_per_gas_cap);
  let maxFee = base * 2n + tip;
  if (maxFee > cap) maxFee = cap;
  return { maxFee, tip: tip > maxFee ? maxFee : tip };
}

const BUMP_ERRORS = /underpriced|less than block base fee|fee cap less than|max fee per gas less than/i;
const ALREADY_SENT = /already known|nonce too low|known transaction|already imported/i;

export async function handleRailB(p: Payout): Promise<void> {
  const cfg = await safu.getEvmChain(p.payout_chain);
  if (!cfg) throw new Error(`payout ${p.id}: chain ${p.payout_chain} has no Rail B config`);

  if (p.status === "Queued") {
    const { maxFee, tip } = await fees(p.payout_chain, cfg);
    log(p.id, `requesting MPC signature (nonce ${p.evm_nonce ?? cfg.next_nonce}, maxFee ${maxFee})`);
    const ok = await safu.requestPayoutSigned(p.id, maxFee, tip);
    if (!ok) {
      log(p.id, "contract rejected the MPC signature (re-queued); will retry next tick");
      return;
    }
    p = (await safu.getPayout(p.id))!;
  }

  if (p.status === "Signed") await broadcastAndConfirm(p, cfg);
}

async function broadcastAndConfirm(p: Payout, cfg: EvmChain): Promise<void> {
  const c = client(p.payout_chain);
  const hash = p.evm_tx_hash!;

  const existing = await c.getTransactionReceipt({ hash }).catch(() => null);
  if (existing) return settle(p, existing.status);

  const gasBal = await c.getBalance({ address: cfg.signer_address });
  const need = BigInt(cfg.gas_limit) * BigInt(cfg.max_fee_per_gas_cap);
  if (gasBal === 0n) {
    log(p.id, `pool address ${cfg.signer_address} on ${p.payout_chain} has 0 native gas — fund it to broadcast ${hash}`);
    return;
  }
  if (gasBal < need) log(p.id, `warning: pool gas balance ${formatEther(gasBal)} may be low`);

  try {
    await c.sendRawTransaction({ serializedTransaction: p.signed_tx! });
    log(p.id, `broadcast ${hash} on ${p.payout_chain}`);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (BUMP_ERRORS.test(msg)) {
      const { maxFee, tip } = await fees(p.payout_chain, cfg);
      log(p.id, `fees too low, re-signing same nonce ${p.evm_nonce} at maxFee ${maxFee}`);
      await safu.requestPayoutSigned(p.id, maxFee, tip);
      return; // next tick broadcasts the new signed tx
    }
    if (!ALREADY_SENT.test(msg)) throw e;
  }

  const receipt = await c
    .waitForTransactionReceipt({ hash, timeout: 90_000 })
    .catch(() => null);
  if (!receipt) {
    log(p.id, `tx ${hash} not mined yet; will check again`);
    return;
  }
  await settle(p, receipt.status);
}

async function settle(p: Payout, status: "success" | "reverted") {
  if (status === "reverted") {
    // USDC transfer reverted (most likely the pool address lacks USDC float).
    // The nonce is consumed; this needs operator attention.
    log(p.id, `tx ${p.evm_tx_hash} REVERTED on ${p.payout_chain} — check pool USDC float`);
    return;
  }
  await safu.markPaid(p.id, p.evm_tx_hash!);
  log(p.id, `PAID on ${p.payout_chain}: ${p.evm_tx_hash}`);
}
