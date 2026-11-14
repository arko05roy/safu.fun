/**
 * Rail A — NEAR Intents payouts to any chain/asset 1Click supports.
 *
 * Queued: get a live 1Click quote (origin = pool USDC on NEAR, destination =
 *   the asset the buyer chose, recipient = the buyer) and hand the contract the
 *   1Click-signed quote. The contract verifies the signature + every field
 *   against the payout, then transfers to the deposit address in the quote.
 * Sent:   poll 1Click status by deposit address; on SUCCESS record the
 *   destination-chain tx hash with `mark_paid`.
 *
 * Stateless: everything needed to resume lives on-chain in the payout record.
 */
import { config } from "./config";
import { safu, type Payout } from "./near";
import { oneClick } from "./oneclick";
import { buildQuoteProof } from "./quoteProof";
import { log } from "./log";

let poolUsdcAsset: string | undefined;
async function originAsset(): Promise<string> {
  poolUsdcAsset ??= `nep141:${(await safu.getConfig()).usdc}`;
  return poolUsdcAsset;
}

export async function handleRailA(p: Payout): Promise<void> {
  if (p.status === "Queued") {
    const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const q = await oneClick.quote({
      dry: false,
      swapType: "EXACT_INPUT",
      slippageTolerance: config.slippageBps,
      originAsset: await originAsset(),
      depositType: "ORIGIN_CHAIN",
      destinationAsset: p.payout_asset,
      amount: p.amount_usdc,
      refundTo: config.contract,
      refundType: "ORIGIN_CHAIN",
      recipient: p.recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline,
    });
    const dep = q.quote.depositAddress;
    if (!dep) throw new Error(`payout ${p.id}: 1Click quote has no depositAddress`);
    log(p.id, `1Click quote ${q.correlationId}: ${p.amount_usdc} USDC -> ~${q.quote.amountOutFormatted} ${p.payout_asset} to ${p.recipient}`);

    // The contract re-verifies this signature and takes the deposit address from it.
    const proof = buildQuoteProof(q);
    const nearTx = await safu.requestPayoutIntents(p.id, proof.fields, proof.signature);
    log(p.id, `USDC sent to 1Click deposit ${dep} (NEAR tx ${nearTx})`);
    await oneClick
      .submitDeposit(nearTx, dep, config.contract)
      .catch((e) => log(p.id, `deposit/submit (optional) failed: ${(e as Error).message}`));
    return;
  }

  if (p.status === "Sent" && p.deposit_address) {
    const s = await oneClick.status(p.deposit_address);
    switch (s.status) {
      case "SUCCESS": {
        const dest = s.swapDetails?.destinationChainTxHashes?.[0];
        if (!dest) {
          log(p.id, "1Click SUCCESS but no destination tx hash yet");
          return;
        }
        await safu.markPaid(p.id, dest.hash);
        log(p.id, `PAID on ${p.payout_chain}: ${dest.explorerUrl || dest.hash}`);
        return;
      }
      case "REFUNDED":
      case "FAILED":
        // Funds return to the contract account (refundTo) outside pool accounting.
        log(p.id, `1Click swap ${s.status} (${s.swapDetails?.refundReason ?? "no reason"}) — operator action needed`);
        return;
      default:
        log(p.id, `1Click status ${s.status}`);
    }
  }
}
