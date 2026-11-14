import { Account } from "near-api-js";
import { config, nearProvider } from "./config";

export type PayoutStatus = "Queued" | "Processing" | "Sent" | "Signed" | "Paid";

/** Mirrors `Payout` in contracts/safu/src/types.rs (JSON). */
export interface Payout {
  id: number;
  policy_id: number;
  report_id: number;
  amount_usdc: string;
  payout_chain: string;
  payout_asset: string;
  recipient: string;
  status: PayoutStatus;
  rail: "Intents" | "ChainSig" | "Near" | null;
  deposit_address: string | null;
  dest_tx_hash: string | null;
  evm_nonce: number | null;
  signed_tx: `0x${string}` | null;
  evm_tx_hash: `0x${string}` | null;
}

export interface EvmChain {
  chain_id: number;
  usdc: `0x${string}`;
  signer_address: `0x${string}`;
  next_nonce: number;
  gas_limit: number;
  max_fee_per_gas_cap: string;
  float_usdc: string;
}

export interface Config {
  usdc: string;
  mpc_signer: string;
}

const TGAS = 1_000_000_000_000n;

export const provider = nearProvider(config.network);
const relayer = new Account(config.relayerAccount, provider, config.relayerKey);

async function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId: config.contract, method, args })) as T;
}

export const safu = {
  getConfig: () => view<Config>("get_config"),
  getPayout: (payout_id: number) => view<Payout | null>("get_payout", { payout_id }),
  getEvmChain: (chain: string) => view<EvmChain | null>("get_evm_chain", { chain }),

  async listPending(): Promise<Payout[]> {
    const out: Payout[] = [];
    for (let from = 0; ; from += 50) {
      const page = await view<Payout[]>("list_pending_payouts", { from_index: from, limit: 50 });
      out.push(...page);
      if (page.length < 50) return out;
    }
  },

  /** Rail B: contract builds + MPC-signs the payout tx. Returns the contract's bool result. */
  async requestPayoutSigned(payoutId: number, maxFeePerGas: bigint, maxPriorityFeePerGas: bigint) {
    return relayer.callFunction<boolean>({
      contractId: config.contract,
      methodName: "request_payout_signed",
      args: {
        payout_id: payoutId,
        max_fee_per_gas: maxFeePerGas.toString(),
        max_priority_fee_per_gas: maxPriorityFeePerGas.toString(),
      },
      gas: 300n * TGAS,
    });
  },

  /**
   * Rail A: contract verifies the 1Click-signed quote and sends the payout USDC
   * to the deposit address inside it. Returns NEAR tx hash.
   */
  async requestPayoutIntents(payoutId: number, quote: Record<string, unknown>, quoteSignature: string): Promise<string> {
    const res = await relayer.callFunctionRaw({
      contractId: config.contract,
      methodName: "request_payout_intents",
      args: { payout_id: payoutId, quote, quote_signature: quoteSignature },
      gas: 100n * TGAS,
    });
    return res.transaction.hash;
  },

  /** NEAR-direct: contract sends pool USDC to the NEAR recipient. Returns NEAR tx hash. */
  async requestPayoutNear(payoutId: number): Promise<string> {
    const res = await relayer.callFunctionRaw({
      contractId: config.contract,
      methodName: "request_payout_near",
      args: { payout_id: payoutId },
      gas: 100n * TGAS,
    });
    return res.transaction.hash;
  },

  async markPaid(payoutId: number, destTxHash: string) {
    await relayer.callFunction({
      contractId: config.contract,
      methodName: "mark_paid",
      args: { payout_id: payoutId, dest_tx_hash: destTxHash },
      gas: 30n * TGAS,
    });
  },
};
