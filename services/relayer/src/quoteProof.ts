/**
 * Builds the exact field object 1Click signs for a quote, so the safu contract
 * can verify it on-chain (contracts/safu/src/intents.rs).
 *
 * Field selection mirrors buildSignedQuoteRequest/buildSignedQuote in
 * @defuse-protocol/one-click-sdk-typescript (not exported). Parity with the
 * SDK is asserted at runtime with its own `quoteHash` + `verifyQuoteSignature`.
 */
import {
  hashQuote,
  quoteHash,
  verifyQuoteSignature,
  type OneClickQuoteResponse,
} from "@defuse-protocol/one-click-sdk-typescript";

export interface QuoteProof {
  fields: Record<string, unknown>;
  signature: string;
}

const orUndef = <T>(v: T | null | undefined | "" | 0) => (v ? v : undefined);

export function buildQuoteProof(res: OneClickQuoteResponse): QuoteProof {
  const r = res.quoteRequest;
  const q = res.quote;
  const request = {
    dry: r.dry,
    swapType: r.swapType,
    slippageTolerance: r.slippageTolerance,
    originAsset: r.originAsset,
    depositType: r.depositType,
    destinationAsset: r.destinationAsset,
    amount: r.amount,
    refundTo: r.refundTo,
    refundType: r.refundType,
    recipient: r.recipient,
    recipientType: r.recipientType,
    deadline: r.deadline,
    quoteWaitingTimeMs: orUndef(r.quoteWaitingTimeMs),
    referral: orUndef(r.referral),
    virtualChainRecipient: orUndef(r.virtualChainRecipient),
    virtualChainRefundRecipient: orUndef(r.virtualChainRefundRecipient),
    customRecipientMsg: orUndef(r.customRecipientMsg),
  };
  const quote = {
    amountIn: q.amountIn,
    amountInFormatted: q.amountInFormatted,
    amountInUsd: q.amountInUsd,
    minAmountIn: q.minAmountIn,
    amountOut: q.amountOut,
    amountOutFormatted: q.amountOutFormatted,
    amountOutUsd: q.amountOutUsd,
    minAmountOut: q.minAmountOut,
    depositAddress: orUndef(q.depositAddress),
    depositMemo: orUndef(q.depositMemo),
    deadline: orUndef(q.deadline),
    timeWhenInactive: orUndef(q.timeWhenInactive),
    timeEstimate: orUndef(q.timeEstimate),
    refundFee: orUndef(q.refundFee),
    withdrawFee: orUndef(q.withdrawFee),
  };

  if (!verifyQuoteSignature(res)) throw new Error("1Click quote signature does not verify (SDK)");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (hashQuote(request as any, quote as any, res.timestamp) !== quoteHash(res)) {
    throw new Error("quote proof diverges from SDK signing payload");
  }

  // JSON round-trip drops undefined keys, exactly like json-stable-stringify.
  const fields = JSON.parse(JSON.stringify({ ...request, ...quote, timestamp: res.timestamp }));
  return { fields, signature: res.signature };
}
