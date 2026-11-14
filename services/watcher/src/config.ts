import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import "dotenv/config";
import { FailoverRpcProvider, JsonRpcProvider } from "near-api-js";

export type Network = "testnet" | "mainnet";

const DEFAULT_NEAR_RPC: Record<Network, string> = {
  testnet: "https://test.rpc.fastnear.com",
  mainnet: "https://free.rpc.fastnear.com",
};
const DEFAULT_NEARBLOCKS: Record<Network, string> = {
  testnet: "https://api-testnet.nearblocks.io",
  mainnet: "https://api.nearblocks.io",
};
/**
 * Public RPCs for token chains; override with EVM_RPC_<CHAIN>. sepolia.base.org
 * caps eth_getLogs at 200 blocks, so publicnode is the Base Sepolia default.
 */
const DEFAULT_EVM_RPC: Record<string, string> = {
  "base-sepolia": "https://base-sepolia-rpc.publicnode.com",
  sepolia: "https://ethereum-sepolia-rpc.publicnode.com",
  base: "https://base-rpc.publicnode.com",
  eth: "https://ethereum-rpc.publicnode.com",
};

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`missing env ${name}`);
  return v;
}

function keyFromKeychain(network: Network, accountId: string): string {
  const p = join(homedir(), ".near-credentials", network, `${accountId}.json`);
  if (!existsSync(p)) throw new Error(`no WATCHER_PRIVATE_KEY and no keychain file at ${p}`);
  return JSON.parse(readFileSync(p, "utf8")).private_key;
}

const network = env("NEAR_NETWORK", "testnet") as Network;
const watcherAccount = env("WATCHER_ACCOUNT");

export const config = {
  network,
  nearRpc: env("NEAR_RPC", DEFAULT_NEAR_RPC[network]),
  nearblocksApi: env("NEARBLOCKS_API", DEFAULT_NEARBLOCKS[network]),
  nearblocksKey: process.env.NEARBLOCKS_API_KEY || undefined,
  contract: env("SAFU_CONTRACT"),
  watcherAccount,
  watcherKey: (process.env.WATCHER_PRIVATE_KEY || keyFromKeychain(network, watcherAccount)) as `ed25519:${string}`,
  pollMs: Number(env("POLL_MS", "15000")),
  heartbeatMs: Number(env("HEARTBEAT_MS", "300000")),
  /** Share of baseline that must leave the wallet(s) to trigger R1/R2 (bps). */
  r1ThresholdBps: Number(env("R1_THRESHOLD_BPS", "5000")),
  r2ThresholdBps: Number(env("R2_THRESHOLD_BPS", "5000")),
  /** Max blocks per eth_getLogs call and how far back to look for evidence. */
  evmLogChunk: Number(env("EVM_LOG_CHUNK", "2000")),
  evmMaxChunks: Number(env("EVM_MAX_CHUNKS", "50")),
  evmRpc(chain: string): string | undefined {
    const key = `EVM_RPC_${chain.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    return process.env[key] || DEFAULT_EVM_RPC[chain];
  },
};

// NEAR RPC with failover: public endpoints rate-limit, so rotate across several.
// Override with NEAR_RPCS (comma-separated).
const DEFAULT_NEAR_RPCS: Record<"testnet" | "mainnet", string[]> = {
  testnet: ["https://test.rpc.fastnear.com", "https://near-testnet.drpc.org"],
  mainnet: ["https://free.rpc.fastnear.com", "https://near.drpc.org"],
};
export function nearProvider(network: "testnet" | "mainnet"): FailoverRpcProvider {
  const urls = (process.env.NEAR_RPCS ?? process.env.NEAR_RPC ?? DEFAULT_NEAR_RPCS[network].join(","))
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  return new FailoverRpcProvider(urls.map((url) => new JsonRpcProvider({ url }, { retries: 3, wait: 500, backoff: 2 })));
}
