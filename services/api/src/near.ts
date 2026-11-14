import { Account, JsonRpcProvider } from "near-api-js";
import { config } from "./config.js";

const TGAS = 1_000_000_000_000n;
export const provider = new JsonRpcProvider({ url: config.nearRpc });
const api = new Account(config.apiAccount, provider, config.apiKey);

export function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return provider.callFunction({ contractId: config.contract, method, args }) as Promise<T>;
}

function call<T>(methodName: string, args: Record<string, unknown>, tgas = 30n): Promise<T> {
  return api.callFunction({ contractId: config.contract, methodName, args, gas: tgas * TGAS }) as Promise<T>;
}

export interface OnchainToken {
  token_key: string;
  active_policy_ids: number[];
  exposure_usdc: string;
  open_report_id: number | null;
  rugged_report_id: number | null;
  watch: {
    deployer: { address: string; baseline: string };
    insiders: { address: string; baseline: string }[];
    snapshot_block: number;
    registered_at_ms: number;
  } | null;
}

export const safu = {
  getToken: (token_chain: string, token_addr: string) => view<OnchainToken>("get_token", { token_chain, token_addr }),
  getConfig: () => view<Record<string, unknown> & { usdc: string; max_token_exposure_bps: number }>("get_config"),
  poolStats: () => view<{ available_usdc: string; reserved_usdc: string; premiums_earned_usdc: string; total_paid_out_usdc: string; policies: number; reports: number; payouts: number }>("pool_stats"),
  getPolicy: (policy_id: number) => view<unknown>("get_policy", { policy_id }),
  getPayout: (payout_id: number) => view<unknown>("get_payout", { payout_id }),
  getReport: (report_id: number) => view<unknown>("get_report", { report_id }),
  lastHeartbeatMs: () => view<number>("last_heartbeat_ms"),

  registerTokenWatch: (
    token_chain: string,
    token_addr: string,
    deployer: { address: string; baseline: string },
    insiders: { address: string; baseline: string }[],
    snapshot_block: number,
  ) => call<void>("register_token_watch", { token_chain, token_addr, deployer, insiders, snapshot_block }),

  registerPolicy: (args: {
    token_chain: string;
    token_addr: string;
    payout_chain: string;
    payout_asset: string;
    recipient: string;
    cover_usdc: string;
    premium_bps: number;
    insiders_root: string;
    buy_ref: string;
    expires_at_ms: number;
  }) => call<number>("register_policy", args),
};
