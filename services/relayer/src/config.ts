import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import "dotenv/config";

export type Network = "testnet" | "mainnet";

const DEFAULT_NEAR_RPC: Record<Network, string> = {
  testnet: "https://rpc.testnet.near.org",
  mainnet: "https://rpc.mainnet.near.org",
};

/** Public RPCs for EVM payout chains; override with EVM_RPC_<CHAIN> (e.g. EVM_RPC_BASE_SEPOLIA). */
const DEFAULT_EVM_RPC: Record<string, string> = {
  "base-sepolia": "https://sepolia.base.org",
  sepolia: "https://ethereum-sepolia-rpc.publicnode.com",
  base: "https://mainnet.base.org",
  eth: "https://ethereum-rpc.publicnode.com",
};

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`missing env ${name}`);
  return v;
}

/** Reads a key from near-cli's legacy keychain (~/.near-credentials/<network>/<account>.json). */
function keyFromKeychain(network: Network, accountId: string): string {
  const p = join(homedir(), ".near-credentials", network, `${accountId}.json`);
  if (!existsSync(p)) throw new Error(`no RELAYER_PRIVATE_KEY and no keychain file at ${p}`);
  return JSON.parse(readFileSync(p, "utf8")).private_key;
}

const network = env("NEAR_NETWORK", "testnet") as Network;
const relayerAccount = env("RELAYER_ACCOUNT");

export const config = {
  network,
  nearRpc: env("NEAR_RPC", DEFAULT_NEAR_RPC[network]),
  contract: env("SAFU_CONTRACT"),
  relayerAccount,
  relayerKey: (process.env.RELAYER_PRIVATE_KEY || keyFromKeychain(network, relayerAccount)) as `ed25519:${string}`,
  pollMs: Number(env("POLL_MS", "15000")),
  /** Rail A (1Click) only exists on mainnet — NEAR Intents has no testnet. */
  railAEnabled: env("RAIL_A_ENABLED", network === "mainnet" ? "true" : "false") === "true",
  /** When both rails can serve a payout: "A" (any asset, any chain) or "B" (signed USDC). */
  railPreference: env("RAIL_PREFERENCE", "A") as "A" | "B",
  oneClickUrl: env("ONECLICK_URL", "https://1click.chaindefuser.com"),
  oneClickJwt: process.env.ONECLICK_JWT || undefined,
  slippageBps: Number(env("SLIPPAGE_BPS", "100")),
  evmRpc(chain: string): string | undefined {
    const key = `EVM_RPC_${chain.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    return process.env[key] || DEFAULT_EVM_RPC[chain];
  },
};
