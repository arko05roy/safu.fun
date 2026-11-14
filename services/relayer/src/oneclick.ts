/** Minimal NEAR Intents 1Click client (https://1click.chaindefuser.com/docs/v0/openapi.yaml). */
import { config } from "./config.js";

export type SwapStatus =
  | "KNOWN_DEPOSIT_TX"
  | "PENDING_DEPOSIT"
  | "INCOMPLETE_DEPOSIT"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED";

export interface QuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN" | "INTENTS";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN" | "INTENTS";
  recipient: string;
  recipientType: "DESTINATION_CHAIN" | "INTENTS";
  deadline: string;
  appFees?: { recipient: string; fee: number }[];
}

export interface QuoteResponse {
  quote: {
    depositAddress?: string;
    amountIn: string;
    amountOut: string;
    minAmountOut: string;
    amountOutFormatted: string;
    deadline?: string;
    timeEstimate: number;
  };
  correlationId: string;
}

export interface StatusResponse {
  status: SwapStatus;
  updatedAt: string;
  swapDetails?: {
    destinationChainTxHashes?: { hash: string; explorerUrl: string }[];
    refundedAmount?: string;
    refundReason?: string;
  };
}

async function req<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.oneClickJwt) headers.authorization = `Bearer ${config.oneClickJwt}`;
  const res = await fetch(`${config.oneClickUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`1Click ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

export const oneClick = {
  quote: (q: QuoteRequest) => req<QuoteResponse>("POST", "/v0/quote", q),
  status: (depositAddress: string) =>
    req<StatusResponse>("GET", `/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`),
  submitDeposit: (txHash: string, depositAddress: string, nearSenderAccount?: string) =>
    req<unknown>("POST", "/v0/deposit/submit", { txHash, depositAddress, nearSenderAccount }),
};
