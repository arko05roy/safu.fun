import { Account, JsonRpcProvider } from "near-api-js";
import { config } from "./config.js";

export interface Holder {
  address: string;
  baseline: string;
}

export interface TokenWatch {
  token_key: string;
  token_chain: string;
  token_addr: string;
  deployer: Holder;
  insiders: Holder[];
  snapshot_block: number;
  registered_at_ms: number;
}

export interface WatchedToken {
  watch: TokenWatch;
  active_policies: number;
  exposure_usdc: string;
  open_report_id: number | null;
}

export interface Report {
  id: number;
  token_key: string;
  rule: string;
  evidence: string[];
  reported_at_ms: number;
  dispute_deadline_ms: number;
  status: "Pending" | "Disputed" | "Rejected" | "Finalized";
}

const TGAS = 1_000_000_000_000n;
const provider = new JsonRpcProvider({ url: config.nearRpc });
const watcher = new Account(config.watcherAccount, provider, config.watcherKey);

function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return provider.callFunction({ contractId: config.contract, method, args }) as Promise<T>;
}

function call<T>(methodName: string, args: Record<string, unknown>, tgas: bigint) {
  return watcher.callFunction<T & {}>({ contractId: config.contract, methodName, args, gas: tgas * TGAS }) as Promise<T>;
}

export const safu = {
  async listWatched(): Promise<WatchedToken[]> {
    const out: WatchedToken[] = [];
    for (let from = 0; ; from += 50) {
      const page = await view<WatchedToken[]>("list_watched", { from_index: from, limit: 50 });
      out.push(...page);
      if (page.length < 50) return out;
    }
  },
  getReport: (report_id: number) => view<Report | null>("get_report", { report_id }),
  reportRug: (token_chain: string, token_addr: string, rule: string, evidence: string[]) =>
    call<number>("report_rug", { token_chain, token_addr, rule, evidence }, 30n),
  finalizeRug: (report_id: number) => call<number[]>("finalize_rug", { report_id }, 300n),
  heartbeat: () => call<void>("heartbeat", {}, 10n),
};
